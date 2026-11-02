/* Lockin — Web Audio focus sounds: rain, brown noise, lo-fi pad. Zero assets. */

const KINDS = ['none', 'rain', 'brown', 'lofi'];

let ctx = null;
let master = null;
let nodes = null; // currently running synth chain
let current = 'none';
let volume = 0.6;

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function brownBuffer() {
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buf;
}

function stopNodes() {
  if (!nodes) return;
  try { nodes.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2); } catch (_) {}
  clearTimeout(nodes.timer);
  const old = nodes;
  setTimeout(() => { try { old.src && old.src.stop(); old.lfo && old.lfo.stop(); } catch (_) {} }, 700);
  nodes = null;
}

function playBrown() {
  const src = ctx.createBufferSource();
  src.buffer = brownBuffer();
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  const gain = ctx.createGain();
  gain.gain.value = 0.9;
  src.connect(lp).connect(gain).connect(master);
  src.start();
  return { src, gain };
}

function playRain() {
  const src = ctx.createBufferSource();
  src.buffer = brownBuffer();
  src.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 380;
  const body = ctx.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = 2400;
  const gain = ctx.createGain();
  gain.gain.value = 0.5;
  src.connect(hp).connect(body).connect(gain).connect(master);
  src.start();

  // droplets: shortFiltered chirps scheduled on a soft interval
  const timer = setInterval(() => {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 900 + Math.random() * 1600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.06, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.1);
  }, 180);
  return { src, gain, timer };
}

function playLofi() {
  // warm chord pad: Am7 drone with a slow filter sweep + tape hiss
  const gain = ctx.createGain();
  gain.gain.value = 0.16;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  lp.Q.value = 0.7;
  gain.connect(lp).connect(master);
  const freqs = [220.0, 261.63, 329.63, 392.0]; // A3 C4 E4 G4
  const oscs = freqs.map((f, i) => {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    o.detune.value = (i % 2 ? 4 : -4);
    o.connect(gain);
    o.start();
    return o;
  });
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.06;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 420;
  lfo.connect(lfoGain).connect(lp.frequency);
  lfo.start();

  const hiss = ctx.createBufferSource();
  hiss.buffer = brownBuffer();
  hiss.loop = true;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0.012;
  const hissHp = ctx.createBiquadFilter();
  hissHp.type = 'highpass';
  hissHp.frequency.value = 1800;
  hiss.connect(hissHp).connect(hissGain).connect(master);
  hiss.start();

  return {
    gain,
    src: { stop() { oscs.forEach((o) => o.stop()); hiss.stop(); } },
    lfo,
  };
}

export const Sounds = {
  KINDS,

  kind() { return current; },

  setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master) master.gain.value = volume;
  },

  play(kind = 'rain') {
    if (!KINDS.includes(kind)) kind = 'none';
    current = kind;
    stopNodes();
    if (kind === 'none' || !window.AudioContext && !window.webkitAudioContext) return;
    ensureCtx();
    nodes = kind === 'rain' ? playRain()
      : kind === 'brown' ? playBrown()
      : kind === 'lofi' ? playLofi()
      : null;
  },

  stop() {
    current = 'none';
    stopNodes();
  },
};
