package com.lockin.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The device-local home of the app-control config. The web app computes the
 * focus windows, the chosen packages, the per-app limits and the strict
 * allowlist; this class stores them and answers "is this package blocked
 * right now?".
 *
 * It is deliberately not part of the synced web store: which apps are blocked,
 * how long they are allowed and which apps a strict session opens are
 * properties of this phone, not of the account.
 */
public final class BlockingStore {

    private static final String PREFS = "lockin_blocking";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_PACKAGES = "packages";
    private static final String KEY_WINDOWS = "windows";
    private static final String KEY_LIMITS = "limits";
    private static final String KEY_STRICT = "strict";
    private static final String KEY_STRICT_PACKAGES = "strict_packages";
    private static final String KEY_STRICT_UNTIL = "strict_until";
    private static final String KEY_USAGE_PRUNE = "usage_pruned_day";
    private static final String USAGE_PREFIX = "usage.";

    /** One focus window, in epoch milliseconds. */
    public static final class Window {
        public final long start;
        public final long end;
        public final String label;

        Window(long start, long end, String label) {
            this.start = start;
            this.end = end;
            this.label = label == null || label.isEmpty() ? "Focus" : label;
        }

        public boolean contains(long now) {
            return start <= now && now < end;
        }
    }

    public static final class Config {
        public final boolean enabled;
        public final Set<String> packages;
        public final List<Window> windows;
        /** package -> daily allowance in minutes; absent/0 means no limit. */
        public final Map<String, Integer> limits;
        public final boolean strict;
        public final long strictUntil;
        public final Set<String> strictPackages;

        Config(boolean enabled, Set<String> packages, List<Window> windows,
               Map<String, Integer> limits, boolean strict, long strictUntil,
               Set<String> strictPackages) {
            this.enabled = enabled;
            this.packages = Collections.unmodifiableSet(packages);
            this.windows = Collections.unmodifiableList(windows);
            this.limits = Collections.unmodifiableMap(limits);
            this.strict = strict;
            this.strictUntil = strictUntil;
            this.strictPackages = Collections.unmodifiableSet(strictPackages);
        }

        public boolean blocks(String pkg, long now) {
            return enabled && packages.contains(pkg) && activeWindow(now) != null;
        }

        public int limitFor(String pkg) {
            Integer minutes = limits.get(pkg);
            return minutes == null ? 0 : minutes;
        }

        /**
         * Strict mode is live only while the session that armed it is still
         * running. The deadline is refreshed by the web app; if it goes stale
         * (the app was killed, the phone rebooted), everything fails open.
         */
        public boolean strictActive(long now) {
            return strict && now < strictUntil;
        }

        /** The latest-starting window that contains `now`; nested blocks win. */
        public Window activeWindow(long now) {
            Window best = null;
            for (Window window : windows) {
                if (!window.contains(now)) continue;
                if (best == null || window.start > best.start) best = window;
            }
            return best;
        }

        public Window nextWindow(long now) {
            for (Window window : windows) {
                if (window.start > now) return window;
            }
            return null;
        }
    }

    private BlockingStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /* ---------- day boundaries ---------- */

    public static String dayKey(long now) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(now));
    }

    public static long startOfDay(long now) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    public static long nextMidnight(long now) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        c.add(Calendar.DAY_OF_YEAR, 1);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /* ---------- read ---------- */

    public static Config read(Context context) {
        SharedPreferences p = prefs(context);
        boolean enabled = p.getBoolean(KEY_ENABLED, false);

        Set<String> packages = new LinkedHashSet<>();
        try {
            JSONArray raw = new JSONArray(p.getString(KEY_PACKAGES, "[]"));
            for (int i = 0; i < raw.length(); i++) {
                String pkg = raw.optString(i, "").trim();
                if (!pkg.isEmpty()) packages.add(pkg);
            }
        } catch (JSONException ignored) {
            /* a corrupt list blocks nothing — fail open */
        }

        List<Window> windows = new ArrayList<>();
        try {
            JSONArray raw = new JSONArray(p.getString(KEY_WINDOWS, "[]"));
            for (int i = 0; i < raw.length(); i++) {
                JSONObject item = raw.optJSONObject(i);
                if (item == null) continue;
                long start = item.optLong("start", 0L);
                long end = item.optLong("end", 0L);
                if (start <= 0 || end <= start) continue;
                windows.add(new Window(start, end, item.optString("label", "Focus")));
            }
        } catch (JSONException ignored) {
            /* fail open */
        }
        Collections.sort(windows, (a, b) -> Long.compare(a.start, b.start));

        Map<String, Integer> limits = new HashMap<>();
        try {
            JSONObject raw = new JSONObject(p.getString(KEY_LIMITS, "{}"));
            java.util.Iterator<String> keys = raw.keys();
            while (keys.hasNext()) {
                String pkg = keys.next();
                int minutes = raw.optInt(pkg, 0);
                if (minutes > 0) limits.put(pkg, Math.min(1440, minutes));
            }
        } catch (JSONException ignored) {
            /* fail open */
        }

        boolean strict = p.getBoolean(KEY_STRICT, false);
        long strictUntil = p.getLong(KEY_STRICT_UNTIL, 0L);
        Set<String> strictPackages = new LinkedHashSet<>();
        try {
            JSONArray raw = new JSONArray(p.getString(KEY_STRICT_PACKAGES, "[]"));
            for (int i = 0; i < raw.length(); i++) {
                String pkg = raw.optString(i, "").trim();
                if (!pkg.isEmpty()) strictPackages.add(pkg);
            }
        } catch (JSONException ignored) {
            /* fail open */
        }

        return new Config(enabled, packages, windows, limits, strict, strictUntil, strictPackages);
    }

    /* ---------- write ---------- */

    /** Replace the master switch and the chosen packages; everything else is kept. */
    public static void writeApps(Context context, boolean enabled, JSONArray packages) {
        prefs(context).edit()
                .putBoolean(KEY_ENABLED, enabled)
                .putString(KEY_PACKAGES, packages.toString())
                .apply();
    }

    /** Replace the window list; the switch, packages, limits and strict state are kept. */
    public static void writeWindows(Context context, JSONArray windows) {
        prefs(context).edit()
                .putString(KEY_WINDOWS, windows.toString())
                .apply();
    }

    /** Replace the per-app daily allowances. */
    public static void writeLimits(Context context, JSONObject limits) {
        prefs(context).edit()
                .putString(KEY_LIMITS, limits.toString())
                .apply();
    }

    /** Arm or disarm strict mode. `until` is a fail-open deadline. */
    public static void writeStrict(Context context, boolean active, JSONArray packages, long until) {
        prefs(context).edit()
                .putBoolean(KEY_STRICT, active)
                .putString(KEY_STRICT_PACKAGES, packages.toString())
                .putLong(KEY_STRICT_UNTIL, active ? until : 0L)
                .apply();
    }

    /** Push the fail-open deadline forward without touching the allowlist. */
    public static void refreshStrict(Context context, long until) {
        prefs(context).edit()
                .putLong(KEY_STRICT_UNTIL, until)
                .apply();
    }

    public static void clearStrict(Context context) {
        prefs(context).edit()
                .putBoolean(KEY_STRICT, false)
                .putLong(KEY_STRICT_UNTIL, 0L)
                .apply();
    }

    /* ---------- foreground usage, per app per local day ---------- */

    /**
     * The service counts its own foreground time. It is accurate to the last
     * flush (an app switch, screen off, the 15-second watch, service destroy)
     * and needs no usage-access permission. Days older than yesterday are
     * pruned on the first write of a new day.
     */
    public static void addUsage(Context context, String pkg, long ms, long now) {
        if (pkg == null || pkg.isEmpty() || ms <= 0) return;
        SharedPreferences p = prefs(context);
        String key = USAGE_PREFIX + dayKey(now) + "." + pkg;
        p.edit().putLong(key, p.getLong(key, 0L) + ms).apply();
        pruneUsage(p, now);
    }

    public static long usageFor(Context context, String pkg, long now) {
        return prefs(context).getLong(USAGE_PREFIX + dayKey(now) + "." + pkg, 0L);
    }

    public static Map<String, Long> usageToday(Context context, long now) {
        String prefix = USAGE_PREFIX + dayKey(now) + ".";
        Map<String, Long> out = new HashMap<>();
        for (Map.Entry<String, ?> entry : prefs(context).getAll().entrySet()) {
            String key = entry.getKey();
            if (!key.startsWith(prefix)) continue;
            Object value = entry.getValue();
            if (!(value instanceof Long)) continue;
            long ms = (Long) value;
            if (ms > 0) out.put(key.substring(prefix.length()), ms);
        }
        return out;
    }

    private static void pruneUsage(SharedPreferences p, long now) {
        String today = dayKey(now);
        if (today.equals(p.getString(KEY_USAGE_PRUNE, ""))) return;

        String yesterday = dayKey(now - 86_400_000L);
        SharedPreferences.Editor editor = p.edit();
        for (String key : p.getAll().keySet()) {
            if (!key.startsWith(USAGE_PREFIX)) continue;
            String rest = key.substring(USAGE_PREFIX.length());
            int dot = rest.indexOf('.');
            String day = dot > 0 ? rest.substring(0, dot) : "";
            if (!day.equals(today) && !day.equals(yesterday)) editor.remove(key);
        }
        editor.putString(KEY_USAGE_PRUNE, today).apply();
    }
}
