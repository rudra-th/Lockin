/* Lockin — pure sync math.
   Diffing, last-write-wins merging, tombstones and pull cursors for cloud
   sync. No DOM, no storage, no network: the engine in assets/js/sync.js
   drives it, and the self-check suite runs it under Node. */

/** JSON with sorted keys, so two copies of the same data always compare equal. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A copy of an entity without sync bookkeeping (updatedAt). */
function strip(entity) {
  if (!entity || typeof entity !== 'object') return entity;
  const rest = { ...entity };
  delete rest.updatedAt;
  return rest;
}

function sameContent(a, b) {
  return stableStringify(strip(a)) === stableStringify(strip(b));
}

/**
 * Diff one collection against its shadow map (id → last-known entity or
 * `{id, deleted:true}` tombstone). Entities whose content changed, or that
 * the shadow has never seen, come back as upserts; ids the shadow holds but
 * the store no longer does come back as removals. `updatedAt` never counts
 * as a change by itself.
 */
export function diffCollection(current, shadow) {
  const upserts = [];
  const present = new Set();
  for (const e of current || []) {
    if (!e || !e.id) continue;
    present.add(e.id);
    const known = shadow[e.id];
    if (!known || known.deleted || !sameContent(e, known)) upserts.push(e);
  }
  const removedIds = Object.keys(shadow || {})
    .filter((id) => !shadow[id].deleted && !present.has(id));
  return { upserts, removedIds };
}

/** True when a scalar slice (profile, settings) changed since the shadow. */
export function diffScalar(current, shadow) {
  return stableStringify(strip(current ?? null)) !== stableStringify(strip(shadow ?? null));
}

/**
 * Merge remote docs into a local array.
 * 'append' (sessions, slips): union by id — history is immutable, a local
 * copy is never overwritten.
 * 'lww' (tasks, schedules): the newest updatedAt wins; a tie with differing
 * content goes to the remote copy. A tombstone (`deleted: true`) removes the
 * local copy unless the local copy was edited after the tombstone.
 */
export function mergeDocs(localArr, remoteDocs, mode) {
  const arr = (localArr || []).slice();
  const byId = new Map(arr.map((e) => [e.id, e]));
  let added = 0;
  let updated = 0;
  let deleted = 0;
  for (const doc of remoteDocs || []) {
    if (!doc || !doc.id) continue;
    const local = byId.get(doc.id);
    if (mode === 'append') {
      if (!local) {
        arr.push({ ...doc });
        byId.set(doc.id, arr[arr.length - 1]);
        added += 1;
      }
      continue;
    }
    const localAt = local?.updatedAt || 0;
    const remoteAt = doc.updatedAt || 0;
    if (doc.deleted) {
      if (local && remoteAt >= localAt) {
        arr.splice(arr.indexOf(local), 1);
        byId.delete(doc.id);
        deleted += 1;
      }
      continue;
    }
    if (!local) {
      arr.push({ ...doc });
      byId.set(doc.id, arr[arr.length - 1]);
      added += 1;
    } else if (remoteAt >= localAt && !sameContent(local, doc)) {
      /* Identical content is never an update, even when the remote clock is
         newer — replacing it would re-trigger "changed" and sync forever. */
      arr[arr.indexOf(local)] = { ...doc };
      byId.set(doc.id, arr[arr.indexOf(local)]);
      updated += 1;
    }
  }
  return { arr, added, updated, deleted };
}

/** Last-write-wins for a scalar slice; identical content never churns. */
export function mergeScalar(local, remote) {
  if (!remote) return local;
  if (sameContent(local, remote)) return local;
  const localAt = local?.updatedAt || 0;
  const remoteAt = remote.updatedAt || 0;
  return remoteAt >= localAt ? remote : local;
}

/** Advance the incremental-pull cursor to the newest updatedAt seen. */
export function nextCursor(cursor, docs) {
  let next = cursor || 0;
  for (const d of docs || []) {
    const at = d?.updatedAt || 0;
    if (at > next) next = at;
  }
  return next;
}
