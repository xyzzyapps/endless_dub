// Endless Dub — generative dub techno in the browser.
// Interaction model owes a debt to Vitling's Endless Acid Banger
// and Zykure's spicy fork. The synthesis and patterns are original.

const NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const ROWS = [
  { id: "kick", name: "Kick", cls: "kick" },
  { id: "hat", name: "Hi-hat", cls: "" },
  { id: "open", name: "Open", cls: "open" },
  { id: "snare", name: "Snare", cls: "snare" },
  { id: "perc", name: "Rim", cls: "" },
  { id: "bass", name: "Sub", cls: "" },
  { id: "stab", name: "Chord", cls: "chord" },
  { id: "plate", name: "Plate", cls: "plate" },
];

// Square-plate modes. Ratios follow sqrt(m^2 + n^2), the simple Chladni model.
const PLATE_MODES = [[1, 2], [2, 1], [2, 2], [1, 3], [3, 1], [3, 2], [2, 3], [3, 3], [1, 4], [4, 1]];

const state = {
  bpm: 122,
  swing: 0.14,
  playing: false,
  autopilot: true,
  bar: 0,
  step: 0,
  nextTime: 0,
  root: 50, // D3, chord register
  degree: 0,
  holdBars: 0,
  minHold: 16,
  breakdown: 0,
  patterns: {},
  delayBeats: 0.75,
  feedback: 0.7,
  damp: 1400,
  cutoff: 680,
  reso: 6,
  decay: 0.28,
  send: 0.62,
  reverb: 0.34,
  bassLvl: 0.78,
  drive: 0.22,
  color: { hex: "#3ec2ff", r: 62, g: 194, b: 255 },
  lvl: { kick: 1, hat: 1, open: 0.85, snare: 1, rim: 1, stab: 1, plate: 0.7 },
  len: { kick: 0.42, hat: 0.03, open: 0.22, snare: 0.14, rim: 0.07, bass: 0.55 },
  plate: { tension: 1, ring: 1.8, order: 6 },
  drift: {
    cutoff: true,
    feedback: true,
    damp: false,
    reverb: false,
    decay: false,
    pattern: true,
    chord: true,
    breakdown: false,
  },
  weight: {
    cutoff: 1,
    feedback: 0.25,
    damp: 1,
    reverb: 1,
    decay: 1,
    pattern: 1,
    chord: 1,
    breakdown: 1,
  },
  stepWeight: [1, 0.35, 0.55, 0.3, 0.85, 0.4, 0.6, 0.3, 0.9, 0.35, 0.55, 0.3, 0.85, 0.4, 0.7, 0.3],
  cutoffGlide: true,
  cutoffTarget: 680,
  cutoffRetarget: 0,
  cutoffStamp: 0,
  cutoffUi: 0,
};

const $ = (id) => document.getElementById(id);

let ctx, master, drumBus, musicBus, duck, delaySend, reverbSend;
let delayL, delayR, fbL, fbR, dampL, dampR;
let comp, shaper, analyser;
let noiseBuf;
let timer;
let recorder = null;
let recordMute = null;
let recordChunks = [];
let recordSamples = 0;
let recording = false;
let recordStopping = false;
let recordStamp = "";
let mediaRecorder = null;
let recordDest = null;
let recordCanvas = null;
let recordCtx = null;
let videoChunks = [];
let plateEnergy = 0.2;
let plateStamp = 0;
let platePhase = 0;
const freqBins = new Uint8Array(512);
const waveBins = new Uint8Array(1024);

function midiToHz(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function chordName() {
  const name = NOTES[((state.root % 12) + 12) % 12];
  const flavors = ["minor", "minor", "sus", "minor 9"];
  return name + " " + flavors[Math.abs(state.degree) % flavors.length];
}

function hit(step, base) {
  return Math.random() < base * state.stepWeight[step];
}

function pickWeighted(pool) {
  let total = 0;
  for (let i = 0; i < pool.length; i++) total += Math.max(0.04, state.stepWeight[pool[i]]);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= Math.max(0.04, state.stepWeight[pool[i]]);
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function makePattern() {
  const kick = Array.from({ length: 16 }, (_, i) => (i % 4 === 0 && hit(i, 0.95) ? 1 : 0));
  if (!kick.some((v) => v)) kick[pickWeighted([0, 4, 8, 12])] = 1;

  const hat = Array.from({ length: 16 }, (_, i) => (hit(i, i % 2 === 0 ? 0.35 : 0.72) ? 1 : 0));
  hat[0] = 0;

  const open = Array(16).fill(0);
  open[pickWeighted([6, 10, 14])] = 1;
  if (Math.random() < 0.35) {
    const extra = pickWeighted([6, 10, 14]);
    if (hit(extra, 1)) open[extra] = 1;
  }

  const snare = Array(16).fill(0);
  if (hit(4, 0.95)) snare[4] = 1;
  if (hit(12, 0.95)) snare[12] = 1;
  if (!snare[4] && !snare[12]) snare[pickWeighted([4, 12])] = 1;
  if (hit(13, 0.3)) snare[13] = 1;

  const perc = Array(16).fill(0);
  if (hit(6, 0.9)) perc[6] = 1;
  if (hit(14, 0.7)) perc[14] = 1;
  if (hit(10, 0.25)) perc[10] = 1;

  const bass = Array(16).fill(0);
  if (hit(0, 1)) bass[0] = 1;
  const off = pickWeighted([6, 7, 10, 14]);
  if (hit(off, 0.85)) bass[off] = 1;
  if (hit(8, 0.4)) bass[8] = 1;
  if (!bass.some((v) => v)) bass[0] = 1;

  const stab = Array(16).fill(0);
  const candidates = [3, 6, 7, 10, 11, 14];
  const hits = 2 + Math.floor(Math.random() * 2);
  for (let n = 0; n < hits; n++) {
    const i = pickWeighted(candidates);
    if (hit(i, 0.9)) stab[i] = 1;
  }
  if (!stab.some((v) => v)) stab[pickWeighted(candidates)] = 1;

  const plate = Array(16).fill(0);
  const plateAt = pickWeighted([2, 7, 10, 11, 15]);
  plate[plateAt] = 1;
  if (Math.random() < 0.4) {
    const extra = pickWeighted([2, 7, 10, 11, 15]);
    if (hit(extra, 0.8)) plate[extra] = 1;
  }

  state.patterns = { kick, hat, open, snare, perc, bass, stab, plate };
}

function seedPattern() {
  state.patterns = {
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    hat:  [0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0],
    open: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    snare:[0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    perc: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    bass: [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0],
    stab: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    plate:[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  };
}

function renderGrids() {
  const root = $("grids");
  root.innerHTML = "";
  ROWS.forEach((row) => {
    const el = document.createElement("div");
    el.className = "row";
    const title = document.createElement("h3");
    title.textContent = row.name;
    const steps = document.createElement("div");
    steps.className = "steps";
    state.patterns[row.id].forEach((on, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "step " + row.cls + (on ? " on" : "") + (i % 4 === 0 ? " downbeat" : "");
      b.addEventListener("click", () => {
        state.patterns[row.id][i] = state.patterns[row.id][i] ? 0 : 1;
        b.classList.toggle("on");
      });
      steps.appendChild(b);
    });
    el.append(title, steps);
    root.appendChild(el);
  });
}

function paintGrids() {
  const rows = document.querySelectorAll(".row");
  rows.forEach((rowEl, r) => {
    const id = ROWS[r].id;
    rowEl.querySelectorAll(".step").forEach((step, i) => {
      step.classList.toggle("on", !!state.patterns[id][i]);
    });
  });
}

function noiseBuffer() {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function envGain(t, attack, hold, release, peak) {
  const g = ctx.createGain();
  const level = Math.max(0.0001, peak);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + attack);
  g.gain.setValueAtTime(level, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  return g;
}

function noiseBurst(t, dur, filterType, freq, q, peak, dest) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.setValueAtTime(freq, t);
  f.Q.value = q;
  const g = envGain(t, 0.002, 0, dur, peak);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function playKick(t) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(165, t);
  const kickLen = state.len.kick;
  o.frequency.exponentialRampToValueAtTime(46, t + Math.min(0.07, kickLen * 0.4));
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.95 * state.lvl.kick), t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + kickLen);
  o.connect(g); g.connect(drumBus);
  o.start(t); o.stop(t + kickLen + 0.03);
  noiseBurst(t, 0.018, "highpass", 1800, 0.7, 0.28 * state.lvl.kick, drumBus);

  const duckG = duck.gain;
  duckG.cancelScheduledValues(t);
  duckG.setValueAtTime(1, t);
  duckG.linearRampToValueAtTime(0.62, t + 0.03);
  duckG.linearRampToValueAtTime(1, t + 0.22);
}

function playHat(t, open) {
  const swingDelay = (state.step % 2 === 1) ? (60 / state.bpm) / 4 * state.swing : 0;
  const when = t + swingDelay;
  const level = open ? state.lvl.open : state.lvl.hat;
  const dur = open ? state.len.open : state.len.hat;
  noiseBurst(when, dur, "highpass", open ? 5200 : 8000, 0.55, (open ? 0.16 : 0.07) * level, drumBus);
  if (open) noiseBurst(when, dur * 0.7, "bandpass", 9000, 0.7, 0.05 * level, drumBus);
}

function playSnare(t) {
  const body = ctx.createOscillator();
  body.type = "triangle";
  body.frequency.setValueAtTime(196, t);
  const sn = state.lvl.snare;
  const snLen = state.len.snare;
  body.frequency.exponentialRampToValueAtTime(150, t + Math.min(0.12, snLen));
  const bodyGain = envGain(t, 0.002, 0.01, snLen, 0.28 * sn);
  body.connect(bodyGain);
  bodyGain.connect(drumBus);
  body.start(t);
  body.stop(t + snLen + 0.05);

  [0, 0.012, 0.024].forEach((offset, i) => {
    noiseBurst(t + offset, Math.max(0.02, snLen * (0.7 - i * 0.15)), "bandpass", 1800, 0.8, (0.22 - i * 0.04) * sn, drumBus);
  });
  noiseBurst(t, snLen * 0.8, "highpass", 2500, 0.5, 0.16 * sn, delaySend);
}

function playRim(t) {
  [380, 640].forEach((freq, i) => {
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq, t);
    const g = envGain(t, 0.001, 0, state.len.rim, (i === 0 ? 0.18 : 0.1) * state.lvl.rim);
    o.connect(g); g.connect(drumBus);
    o.start(t); o.stop(t + state.len.rim + 0.03);
  });
  noiseBurst(t, Math.min(0.04, state.len.rim), "bandpass", 1800, 1.2, 0.08 * state.lvl.rim, drumBus);
}

function playBass(t, step) {
  const root = state.root - 24;
  let note = root;
  if (step === 8 || step === 10) note = root + 7;
  if (step % 7 === 6) note = root + (Math.random() < 0.5 ? 0 : 7);
  const o = ctx.createOscillator();
  const sub = ctx.createOscillator();
  o.type = "sine";
  sub.type = "sine";
  o.frequency.setValueAtTime(midiToHz(note), t);
  sub.frequency.setValueAtTime(midiToHz(note - 12), t);
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(220, t);
  const bassLen = state.len.bass;
  const g = envGain(t, 0.012, 0.05, bassLen, 0.55 * state.bassLvl);
  const g2 = envGain(t, 0.02, 0.08, bassLen * 1.15, 0.45 * state.bassLvl);
  o.connect(f); f.connect(g); g.connect(musicBus);
  sub.connect(g2); g2.connect(musicBus);
  o.start(t); sub.start(t);
  o.stop(t + bassLen + 0.15); sub.stop(t + bassLen * 1.15 + 0.15);
}

function stabNotes() {
  const r = state.root + state.degree;
  const roll = (state.bar + state.degree) % 3;
  if (roll === 0) return [r, r + 7, r + 15, r + 14]; // sus-ish open + 9th
  if (roll === 1) return [r, r + 3, r + 10, r + 19]; // m7 spread, 11th
  return [r, r + 7, r + 15, r + 26]; // fifth + 9 + high 5th
}

function playStab(t) {
  const notes = stabNotes();
  const peak = 0.11 * state.lvl.stab;
  notes.forEach((n, idx) => {
    [-7, 0, 6].forEach((cents) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(midiToHz(n), t);
      o.detune.setValueAtTime(cents + (idx - 1) * 2, t);
      const f1 = ctx.createBiquadFilter();
      const f2 = ctx.createBiquadFilter();
      f1.type = "lowpass";
      f2.type = "lowpass";
      const start = Math.min(4200, state.cutoff * (2.4 + state.reso / 10));
      f1.frequency.setValueAtTime(start, t);
      f1.frequency.exponentialRampToValueAtTime(Math.max(80, state.cutoff * 0.55), t + state.decay);
      f2.frequency.setValueAtTime(start * 0.85, t);
      f2.frequency.exponentialRampToValueAtTime(Math.max(90, state.cutoff * 0.45), t + state.decay);
      f1.Q.setValueAtTime(0.4 + state.reso / 10, t);
      f2.Q.value = 0.6;
      const g = envGain(t, 0.008, 0.02, state.decay, peak);
      o.connect(f1); f1.connect(f2); f2.connect(g);
      g.connect(musicBus);
      g.connect(delaySend);
      g.connect(reverbSend);
      o.start(t);
      o.stop(t + state.decay + 0.08);
    });
  });
  noiseBurst(t, 0.06, "bandpass", 900, 0.8, 0.05, delaySend);
}

function buildGraph() {
  ctx = new AudioContext();
  noiseBuf = noiseBuffer();

  drumBus = ctx.createGain();
  musicBus = ctx.createGain();
  duck = ctx.createGain();
  delaySend = ctx.createGain();
  reverbSend = ctx.createGain();
  drumBus.gain.value = 0.9;
  musicBus.connect(duck);

  master = ctx.createGain();
  master.gain.value = 0.85;

  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * 2 - 1;
    const amt = 1 + state.drive * 8;
    curve[i] = Math.tanh(x * amt) / Math.tanh(amt);
  }
  shaper = ctx.createWaveShaper();
  shaper.curve = curve;
  shaper.oversample = "2x";

  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 18;
  comp.ratio.value = 3.2;
  comp.attack.value = 0.012;
  comp.release.value = 0.28;

  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.35;

  drumBus.connect(shaper);
  duck.connect(shaper);
  shaper.connect(comp);
  comp.connect(analyser);
  analyser.connect(master);
  master.connect(ctx.destination);

  // Ping-pong delay with a lowpass in the feedback loop.
  delayL = ctx.createDelay(2);
  delayR = ctx.createDelay(2);
  fbL = ctx.createGain();
  fbR = ctx.createGain();
  dampL = ctx.createBiquadFilter();
  dampR = ctx.createBiquadFilter();
  dampL.type = "lowpass";
  dampR.type = "lowpass";
  const panL = ctx.createStereoPanner();
  const panR = ctx.createStereoPanner();
  panL.pan.value = -0.75;
  panR.pan.value = 0.75;
  const delayOut = ctx.createGain();
  delayOut.gain.value = 0.85;

  delaySend.connect(delayL);
  delayL.connect(dampL); dampL.connect(fbL); fbL.connect(delayR);
  delayR.connect(dampR); dampR.connect(fbR); fbR.connect(delayL);
  delayL.connect(panL); delayR.connect(panR);
  panL.connect(delayOut); panR.connect(delayOut);
  delayOut.connect(duck);

  buildReverb();
  applyParams();
}

function buildReverb() {
  const len = ctx.sampleRate * 3.2;
  const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = impulse.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const decay = Math.pow(1 - i / len, 2.4);
      d[i] = (Math.random() * 2 - 1) * decay;
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = impulse;
  const pre = ctx.createBiquadFilter();
  pre.type = "lowpass";
  pre.frequency.value = 2800;
  const g = ctx.createGain();
  g.gain.value = 1;
  reverbSend.connect(pre);
  pre.connect(conv);
  conv.connect(g);
  g.connect(duck);
  state._reverbGain = g;
}

function applyParams() {
  if (!ctx) return;
  const beat = 60 / state.bpm;
  delayL.delayTime.setTargetAtTime(beat * state.delayBeats, ctx.currentTime, 0.05);
  delayR.delayTime.setTargetAtTime(beat * state.delayBeats, ctx.currentTime, 0.05);
  fbL.gain.setTargetAtTime(state.feedback, ctx.currentTime, 0.05);
  fbR.gain.setTargetAtTime(state.feedback, ctx.currentTime, 0.05);
  dampL.frequency.setTargetAtTime(state.damp, ctx.currentTime, 0.05);
  dampR.frequency.setTargetAtTime(state.damp, ctx.currentTime, 0.05);
  delaySend.gain.setTargetAtTime(state.send, ctx.currentTime, 0.05);
  reverbSend.gain.setTargetAtTime(state.reverb * 0.7, ctx.currentTime, 0.05);
  if (state._reverbGain) state._reverbGain.gain.setTargetAtTime(0.9, ctx.currentTime, 0.05);

  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * 2 - 1;
    const amt = 1 + state.drive * 10;
    curve[i] = Math.tanh(x * amt) / Math.tanh(amt);
  }
  shaper.curve = curve;
}

function playPlate(t) {
  const f0 = midiToHz(state.root + 12) * state.plate.tension;
  const ring = state.plate.ring;
  const amp = 0.07 * state.lvl.plate;
  const order = state.plate.order;
  const fundamental = Math.sqrt(1 + 4);
  PLATE_MODES.slice(0, order).forEach(([m, n], i) => {
    const ratio = Math.sqrt(m * m + n * n) / fundamental;
    const freq = Math.min(f0 * ratio, 12000);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, t);
    const g = envGain(t, 0.002, 0, ring / ratio, amp / (1 + i * 0.45));
    o.connect(g);
    g.connect(musicBus);
    g.connect(reverbSend);
    const send = ctx.createGain();
    send.gain.value = 0.35;
    g.connect(send);
    send.connect(delaySend);
    o.start(t);
    o.stop(t + ring / ratio + 0.05);
  });
  noiseBurst(t, 0.025, "bandpass", Math.min(f0 * 3, 8000), 1.4, amp * 2.2, musicBus);
}

function playStep(step, t) {
  const p = state.patterns;
  const broken = state.breakdown > 0;
  if (p.kick[step] && !broken) playKick(t);
  if (p.hat[step] && Math.random() < (broken ? 0.45 : 0.92)) playHat(t, false);
  if (p.open[step] && Math.random() < (broken ? 0.4 : 1)) playHat(t, true);
  if (p.snare[step] && !broken) playSnare(t);
  if (p.perc[step] && !broken) playRim(t);
  if (p.bass[step] && !broken) playBass(t, step);
  if (p.stab[step]) playStab(t);
  if (p.plate[step]) playPlate(t);
}

function onBar() {
  state.bar += 1;
  state.holdBars += 1;
  if (state.breakdown > 0) state.breakdown -= 1;
  $("barCount").textContent = "bar " + state.bar;
  if (!state.autopilot) return;

  if (state.bar % 8 === 0) {
    const d = state.drift;
    const w = state.weight;
    const sway = (span) => (Math.random() * 2 - 1) * span;
    if (d.feedback) state.feedback = clamp(state.feedback + sway(0.02 * w.feedback), 0.45, 0.75);
    if (d.damp) state.damp = clamp(state.damp + sway(350 * w.damp), 500, 4200);
    if (d.reverb) state.reverb = clamp(state.reverb + sway(0.08 * w.reverb), 0.05, 0.8);
    if (d.decay) state.decay = clamp(state.decay + sway(0.08 * w.decay), 0.09, 0.8);
    syncControls();
    applyParams();
  }
  if (state.bar % 16 === 0 && state.drift.pattern && state.weight.pattern > 0) {
    mutatePattern();
    paintGrids();
  }
  if (state.drift.chord && state.weight.chord > 0 && state.holdBars >= state.minHold && state.bar % 16 === 0 && Math.random() < 0.65 * state.weight.chord) {
    shiftChord();
  }
  if (state.drift.breakdown && state.weight.breakdown > 0 && state.bar % 32 === 0 && Math.random() < 0.7 * state.weight.breakdown) {
    state.breakdown = 4;
  }
}

function mutatePattern() {
  const w = state.weight.pattern;
  const hat = state.patterns.hat;
  if (Math.random() < w) {
    const i = pickWeighted([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    hat[i] = hat[i] ? 0 : 1;
  }
  if (Math.random() < 0.4 * w) {
    const open = state.patterns.open;
    const idx = pickWeighted([2, 6, 10, 14]);
    open[idx] = open[idx] ? 0 : 1;
    if (open.reduce((a, b) => a + b, 0) > 3) open[idx] = 0;
  }
  const stab = state.patterns.stab;
  if (Math.random() < 0.5 * w) {
    const idx = pickWeighted([3, 6, 7, 10, 11, 14]);
    stab[idx] = stab[idx] ? 0 : 1;
    if (stab.reduce((a, b) => a + b, 0) < 2) stab[pickWeighted([3, 6, 10, 14])] = 1;
    if (stab.reduce((a, b) => a + b, 0) > 4) stab[idx] = 0;
  }
  const kick = state.patterns.kick;
  if (Math.random() < 0.4 * w) kick[8] = kick[8] ? 0 : 1;
  kick[0] = 1;
  const snare = state.patterns.snare;
  snare[4] = 1;
  snare[12] = 1;
  if (Math.random() < 0.35 * w * state.stepWeight[13]) snare[13] = snare[13] ? 0 : 1;
  if (Math.random() < 0.45 * w) {
    const plate = state.patterns.plate;
    const idx = pickWeighted([2, 7, 10, 11, 15]);
    plate[idx] = plate[idx] ? 0 : 1;
    if (plate.reduce((a, b) => a + b, 0) > 2) plate[idx] = 0;
    if (plate.reduce((a, b) => a + b, 0) === 0) plate[10] = 1;
  }
}

function shiftChord() {
  const moves = [0, 5, 8, 3, -2, 7];
  state.degree = moves[Math.floor(Math.random() * moves.length)];
  state.holdBars = 0;
  state.minHold = 16 + Math.floor(Math.random() * 16);
  $("keyName").textContent = chordName();
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3)].map((v) => Math.round(v * 255));
}

function rgbHex(rgb) {
  return "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
}

function applyBase(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const [h, s, l] = rgbToHsl(r, g, b);
  const sat = Math.max(0.35, Math.min(0.85, s || 0.55));
  const accent = [r, g, b];
  const glow = hslToRgb(h, Math.min(0.9, sat + 0.1), 0.78);
  const step = hslToRgb(h, sat, 0.62);
  const snare = hslToRgb(h, Math.min(1, sat + 0.15), 0.48);
  const kick = hslToRgb(h, 0.22, 0.94);
  const line = hslToRgb(h, 0.7, 0.28);
  const ink = hslToRgb(h, 0.45, 0.86);
  const dim = hslToRgb(h, 0.35, 0.58);
  const bg = hslToRgb(h, 0.55, 0.035);
  const panel = hslToRgb(h, 0.5, 0.07);
  const field = hslToRgb(h, 0.6, 0.045);
  state.color = { hex, r, g, b };
  state.palette = { field, node: accent, glow };
  const root = document.documentElement.style;
  root.setProperty("--accent", hex);
  root.setProperty("--on", rgbHex(step));
  root.setProperty("--accent-rgb", r + ", " + g + ", " + b);
  root.setProperty("--glow", rgbHex(glow));
  root.setProperty("--line", rgbHex(line));
  root.setProperty("--kick", rgbHex(kick));
  root.setProperty("--snare", rgbHex(snare));
  root.setProperty("--ink", rgbHex(ink));
  root.setProperty("--dim", rgbHex(dim));
  root.setProperty("--bg", rgbHex(bg));
  root.setProperty("--panel", rgbHex(panel));
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function wavBlob(chunks, sampleRate) {
  let sampleCount = 0;
  for (let i = 0; i < chunks.length; i++) sampleCount += chunks[i].length;
  const dataBytes = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  const pcm = new Int16Array(buffer, 44);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    pcm.set(chunks[i], offset);
    offset += chunks[i].length;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function recClock() {
  const rate = ctx ? ctx.sampleRate : 44100;
  const secs = Math.floor(recordSamples / rate);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  $("recTime").textContent = mm + ":" + ss + " / 30:00";
}

function downloadWav() {
  if (!recordChunks.length || !recordSamples) return;
  const blob = wavBlob(recordChunks, ctx.sampleRate);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  link.href = url;
  link.download = "endless-dub-" + (recordStamp || stamp) + ".wav";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function videoType() {
  if (!window.MediaRecorder) return "";
  const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function startVideo() {
  const mime = videoType();
  if (!mime || !HTMLCanvasElement.prototype.captureStream) return;
  recordCanvas = document.createElement("canvas");
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  recordCanvas.height = 720;
  recordCanvas.width = Math.max(720, Math.min(1280, Math.round(720 * aspect)));
  recordCtx = recordCanvas.getContext("2d", { alpha: false });
  recordCtx.fillStyle = "#01070f";
  recordCtx.fillRect(0, 0, recordCanvas.width, recordCanvas.height);
  const plateStream = recordCanvas.captureStream(25);
  recordDest = ctx.createMediaStreamDestination();
  master.connect(recordDest);
  const stream = new MediaStream([
    plateStream.getVideoTracks()[0],
    recordDest.stream.getAudioTracks()[0],
  ]);
  videoChunks = [];
  mediaRecorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 2000000,
    audioBitsPerSecond: 160000,
  });
  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size) videoChunks.push(event.data);
  };
  mediaRecorder.onstop = () => {
    const type = mediaRecorder.mimeType || mime;
    const ext = type.indexOf("mp4") >= 0 ? "mp4" : "webm";
    const blob = new Blob(videoChunks, { type });
    videoChunks = [];
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "endless-dub-" + recordStamp + "." + ext;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    plateStream.getTracks().forEach((track) => track.stop());
    mediaRecorder = null;
  };
  mediaRecorder.start(1000);
}

function stopVideo() {
  recordCtx = null;
  if (recordDest) {
    try { master.disconnect(recordDest); } catch (err) { /* already disconnected */ }
    recordDest = null;
  }
  if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
}

function stopRecording() {
  if (recordStopping) return;
  if (!recording && !recorder) return;
  recordStopping = true;
  recording = false;
  stopVideo();
  if (recorder) {
    recorder.onaudioprocess = null;
    recorder.disconnect();
    recorder = null;
  }
  if (recordMute) {
    recordMute.disconnect();
    recordMute = null;
  }
  $("record").textContent = "Record";
  $("record").classList.remove("recording");
  downloadWav();
  recordChunks = [];
  recordSamples = 0;
  recordStopping = false;
}

function startRecording() {
  if (!ctx) buildGraph();
  if (ctx.state === "suspended") ctx.resume();
  if (recording) return;
  recordChunks = [];
  recordSamples = 0;
  recordStamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  try { startVideo(); } catch (err) {
    recordCtx = null;
    if (recordDest) {
      try { master.disconnect(recordDest); } catch (ignore) { /* no tap yet */ }
      recordDest = null;
    }
    mediaRecorder = null;
  }
  const maxSamples = ctx.sampleRate * 60 * 30;
  recorder = ctx.createScriptProcessor(4096, 2, 2);
  recordMute = ctx.createGain();
  recordMute.gain.value = 0;
  recorder.onaudioprocess = (event) => {
    if (!recording) return;
    const left = event.inputBuffer.getChannelData(0);
    const right = event.inputBuffer.getChannelData(1);
    const take = Math.min(left.length, maxSamples - recordSamples);
    if (take <= 0) {
      stopRecording();
      return;
    }
    const frame = new Int16Array(take * 2);
    for (let i = 0; i < take; i++) {
      const l = Math.max(-1, Math.min(1, left[i]));
      const r = Math.max(-1, Math.min(1, right[i]));
      frame[i * 2] = l < 0 ? l * 0x8000 : l * 0x7fff;
      frame[i * 2 + 1] = r < 0 ? r * 0x8000 : r * 0x7fff;
    }
    recordChunks.push(frame);
    recordSamples += take;
    if ((recordChunks.length & 7) === 0) recClock();
    if (recordSamples >= maxSamples) stopRecording();
  };
  master.connect(recorder);
  recorder.connect(recordMute);
  recordMute.connect(ctx.destination);
  recording = true;
  $("recTime").hidden = false;
  recClock();
  $("record").textContent = "Stop";
  $("record").classList.add("recording");
}

function glideCutoff() {
  if (!ctx || !state.playing || !state.autopilot || !state.drift.cutoff || state.weight.cutoff <= 0) return;
  const now = ctx.currentTime;
  const dt = Math.min(0.1, Math.max(0.001, now - (state.cutoffStamp || now)));
  state.cutoffStamp = now;
  if (now >= state.cutoffRetarget) {
    const span = 280 + 1700 * state.weight.cutoff;
    const lo = clamp(state.cutoff - span, 160, 2400);
    const hi = clamp(state.cutoff + span, 160, 2400);
    state.cutoffTarget = clamp(lo + Math.random() * Math.max(80, hi - lo), 160, 2400);
    state.cutoffRetarget = now + 1.2 + Math.random() * (4.5 - state.weight.cutoff * 2);
  }
  const rate = 0.45 + state.weight.cutoff * 1.6;
  if (state.cutoffGlide) state.cutoff += (state.cutoffTarget - state.cutoff) * (1 - Math.exp(-dt * rate));
  else state.cutoff = state.cutoffTarget;
  if (now - state.cutoffUi > 0.08) {
    state.cutoffUi = now;
    $("cutoff").value = Math.round(state.cutoff);
    $("cutoffVal").textContent = String(Math.round(state.cutoff));
  }
}

function scheduler() {
  glideCutoff();
  if (!state.playing) return;
  const horizon = ctx.currentTime + 0.12;
  const sixteenth = (60 / state.bpm) / 4;
  while (state.nextTime < horizon) {
    playStep(state.step, state.nextTime);
    state.nextTime += sixteenth;
    state.step = (state.step + 1) % 16;
    if (state.step === 0) onBar();
  }
}

function fitPlate() {
  const canvas = $("plate");
  const phone = window.innerWidth < 800;
  const div = phone ? 10 : 5;
  const w = Math.max(phone ? 80 : 180, Math.round(window.innerWidth / div));
  const h = Math.max(phone ? 48 : 100, Math.round(window.innerHeight / div));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function musicDrive() {
  if (!analyser) return { level: 0, bands: [0, 0, 0, 0, 0, 0] };
  analyser.getByteFrequencyData(freqBins);
  analyser.getByteTimeDomainData(waveBins);
  let sum = 0;
  for (let i = 0; i < waveBins.length; i += 8) {
    const s = (waveBins[i] - 128) / 128;
    sum += s * s;
  }
  const level = Math.min(1, Math.sqrt(sum / (waveBins.length / 8)) * 3.4);
  const edges = [1, 6, 16, 40, 90, 200, 480];
  const bands = [];
  for (let b = 0; b < 6; b++) {
    let acc = 0;
    const a = edges[b];
    const z = edges[b + 1];
    for (let i = a; i < z; i++) acc += freqBins[i];
    bands.push(acc / (z - a) / 255);
  }
  return { level, bands };
}

function drawPlate(now) {
  fitPlate();
  const canvas = $("plate");
  const c = canvas.getContext("2d", { alpha: false });
  const w = canvas.width;
  const h = canvas.height;
  const dt = plateStamp ? Math.min(0.05, (now - plateStamp) / 1000) : 0.016;
  plateStamp = now;
  const music = musicDrive();
  const target = 0.12 + music.level * 1.35;
  const follow = music.level > plateEnergy ? 18 : 4;
  plateEnergy += (target - plateEnergy) * Math.min(1, dt * follow);
  platePhase += dt * (0.35 + music.level * 7) * state.plate.tension;
  const img = c.createImageData(w, h);
  const data = img.data;
  const modes = PLATE_MODES.slice(0, state.plate.order);
  const count = modes.length;
  const timeAmp = new Float32Array(count);
  const colSin = new Array(count);
  const rowSin = new Array(count);
  const xDenom = w - 1;
  const yDenom = h - 1;
  for (let i = 0; i < count; i++) {
    const m = modes[i][0];
    const n = modes[i][1];
    const ratio = Math.sqrt(m * m + n * n);
    const band = music.bands[i % music.bands.length];
    const drive = 0.15 + band * 2.4;
    timeAmp[i] = Math.cos(platePhase * ratio * 0.45) * drive / (1 + i * 0.3);
    const col = new Float32Array(w);
    const row = new Float32Array(h);
    for (let x = 0; x < w; x++) col[x] = Math.sin(Math.PI * m * x / xDenom);
    for (let y = 0; y < h; y++) row[y] = Math.sin(Math.PI * n * y / yDenom);
    colSin[i] = col;
    rowSin[i] = row;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let z = 0;
      for (let i = 0; i < count; i++) {
        z += colSin[i][x] * rowSin[i][y] * timeAmp[i];
      }
      const sand = Math.pow(1 - Math.min(1, Math.abs(z) * 1.7), 3) * (0.25 + plateEnergy);
      const p = (y * w + x) * 4;
      const pal = state.palette;
      const nodeR = pal.node[0] * 0.72 + pal.glow[0] * 0.28;
      const nodeG = pal.node[1] * 0.72 + pal.glow[1] * 0.28;
      const nodeB = pal.node[2] * 0.72 + pal.glow[2] * 0.28;
      data[p] = pal.field[0] + sand * (nodeR - pal.field[0]);
      data[p + 1] = pal.field[1] + sand * (nodeG - pal.field[1]);
      data[p + 2] = pal.field[2] + sand * (nodeB - pal.field[2]);
      data[p + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
}

let plateFrame = 0;

function draw(now) {
  requestAnimationFrame(draw);
  plateFrame += 1;
  const phone = window.innerWidth < 800;
  if (!phone || plateFrame % 2 === 0 || recording) drawPlate(now || performance.now());
  if (recording && recordCtx) {
    recordCtx.drawImage($("plate"), 0, 0, recordCanvas.width, recordCanvas.height);
  }
  const canvas = $("scope");
  const c = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  c.fillStyle = "#01070f";
  c.fillRect(0, 0, w, h);
  if (!analyser) {
    c.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--line").trim() || "#0c3a66";
    c.beginPath();
    c.moveTo(0, h / 2);
    c.lineTo(w, h / 2);
    c.stroke();
    return;
  }
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  c.strokeStyle = state.color.hex;
  c.lineWidth = 1.5;
  c.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = (i / data.length) * w;
    const y = (data[i] / 255) * h;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();
}

function bindSlider(id, valId, read, write, fmt) {
  const el = $(id);
  const label = $(valId);
  const push = () => {
    write(read(el));
    if (label) label.textContent = fmt(read(el));
    applyParams();
  };
  el.addEventListener("input", push);
}

function syncControls() {
  $("cutoff").value = Math.round(state.cutoff);
  $("cutoffVal").textContent = Math.round(state.cutoff);
  $("feedback").value = Math.round(state.feedback * 100);
  $("feedbackVal").textContent = Math.round(state.feedback * 100);
  $("damp").value = Math.round(state.damp);
  $("dampVal").textContent = Math.round(state.damp);
  $("reverb").value = Math.round(state.reverb * 100);
  $("reverbVal").textContent = Math.round(state.reverb * 100);
  $("decay").value = Math.round(state.decay * 1000);
  $("decayVal").textContent = Math.round(state.decay * 1000);
  $("keyName").textContent = chordName();
}

function wire() {
  seedPattern();
  renderGrids();
  const stepRoot = $("stepWeights");
  state.stepWeight.forEach((weight, i) => {
    const label = document.createElement("label");
    label.textContent = String(i + 1);
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.value = String(Math.round(weight * 100));
    input.addEventListener("input", () => {
      state.stepWeight[i] = Number(input.value) / 100;
    });
    label.appendChild(input);
    stepRoot.appendChild(label);
  });
  $("keyName").textContent = chordName();

  $("cutoffGlide").addEventListener("change", () => { state.cutoffGlide = $("cutoffGlide").checked; });
  applyBase($("baseColor").value);
  $("baseColor").addEventListener("input", () => applyBase($("baseColor").value));

  $("play").addEventListener("click", async () => {
    if (!ctx) buildGraph();
    if (ctx.state === "suspended") await ctx.resume();
    state.playing = !state.playing;
    $("play").textContent = state.playing ? "Stop" : "Play";
    if (state.playing) {
      state.nextTime = ctx.currentTime + 0.06;
      state.step = 0;
      if (!timer) timer = setInterval(scheduler, 25);
    }
  });

  $("bpm").addEventListener("input", () => {
    state.bpm = Number($("bpm").value);
    $("bpmVal").textContent = state.bpm;
    applyParams();
  });
  $("swing").addEventListener("input", () => {
    state.swing = Number($("swing").value) / 100;
    $("swingVal").textContent = $("swing").value;
  });
  $("autopilot").addEventListener("change", () => {
    state.autopilot = $("autopilot").checked;
  });
  $("regen").addEventListener("click", () => {
    makePattern();
    renderGrids();
  });
  $("chord").addEventListener("click", () => shiftChord());
  $("root").addEventListener("change", () => {
    state.root = 48 + Number($("root").value);
    $("keyName").textContent = chordName();
  });

  bindSlider("cutoff", "cutoffVal", (el) => Number(el.value), (v) => {
    state.cutoff = v;
    state.cutoffTarget = v;
    if (ctx) state.cutoffRetarget = ctx.currentTime + 2;
  }, (v) => String(Math.round(v)));
  bindSlider("reso", "resoVal", (el) => Number(el.value), (v) => { state.reso = v; }, (v) => v.toFixed(1));
  bindSlider("decay", "decayVal", (el) => Number(el.value), (v) => { state.decay = v / 1000; }, (v) => String(Math.round(v)));
  bindSlider("send", "sendVal", (el) => Number(el.value), (v) => { state.send = v / 100; }, (v) => String(Math.round(v)));
  bindSlider("feedback", "feedbackVal", (el) => Number(el.value), (v) => { state.feedback = v / 100; }, (v) => String(Math.round(v)));
  bindSlider("damp", "dampVal", (el) => Number(el.value), (v) => { state.damp = v; }, (v) => String(Math.round(v)));
  bindSlider("reverb", "reverbVal", (el) => Number(el.value), (v) => { state.reverb = v / 100; }, (v) => String(Math.round(v)));
  bindSlider("bassLvl", "bassVal", (el) => Number(el.value), (v) => { state.bassLvl = v / 100; }, (v) => String(Math.round(v)));
  bindSlider("kickLvl", "kickVal", (el) => Number(el.value), (v) => { state.lvl.kick = v / 100; }, (v) => String(Math.round(v)));
  bindSlider("hatLvl", "hatVal", (el) => Number(el.value), (v) => { state.lvl.hat = v / 100; }, (v) => String(Math.round(v)));
  bindSlider("openLvl", "openVal", (el) => Number(el.value), (v) => { state.lvl.open = v / 100; }, (v) => String(Math.round(v)));
  bindSlider("snareLvl", "snareVal", (el) => Number(el.value), (v) => { state.lvl.snare = v / 100; }, (v) => String(Math.round(v)));
  bindSlider("rimLvl", "rimVal", (el) => Number(el.value), (v) => { state.lvl.rim = v / 100; }, (v) => String(Math.round(v)));
  bindSlider("stabLvl", "stabVal", (el) => Number(el.value), (v) => { state.lvl.stab = v / 100; }, (v) => String(Math.round(v)));
  bindSlider("plateLvl", "plateVal", (el) => Number(el.value), (v) => { state.lvl.plate = v / 100; }, (v) => String(Math.round(v)));
  bindSlider("tension", "tensionVal", (el) => Number(el.value), (v) => { state.plate.tension = v / 100; }, (v) => (v / 100).toFixed(2));
  bindSlider("ring", "ringVal", (el) => Number(el.value), (v) => { state.plate.ring = v / 1000; }, (v) => String(Math.round(v)));
  bindSlider("kickLen", "kickLenVal", (el) => Number(el.value), (v) => { state.len.kick = v / 1000; }, (v) => String(Math.round(v)));
  bindSlider("hatLen", "hatLenVal", (el) => Number(el.value), (v) => { state.len.hat = v / 1000; }, (v) => String(Math.round(v)));
  bindSlider("openLen", "openLenVal", (el) => Number(el.value), (v) => { state.len.open = v / 1000; }, (v) => String(Math.round(v)));
  bindSlider("snareLen", "snareLenVal", (el) => Number(el.value), (v) => { state.len.snare = v / 1000; }, (v) => String(Math.round(v)));
  bindSlider("rimLen", "rimLenVal", (el) => Number(el.value), (v) => { state.len.rim = v / 1000; }, (v) => String(Math.round(v)));
  bindSlider("bassLen", "bassLenVal", (el) => Number(el.value), (v) => { state.len.bass = v / 1000; }, (v) => String(Math.round(v)));
  bindSlider("order", "orderVal", (el) => Number(el.value), (v) => { state.plate.order = v; }, (v) => String(v));

  const driftMap = {
    driftCutoff: "cutoff",
    driftFeedback: "feedback",
    driftDamp: "damp",
    driftReverb: "reverb",
    driftDecay: "decay",
    driftPattern: "pattern",
    driftChord: "chord",
    driftBreak: "breakdown",
  };
  Object.entries(driftMap).forEach(([id, key]) => {
    $(id).addEventListener("change", () => { state.drift[key] = $(id).checked; });
  });
  const weightMap = {
    wCutoff: "cutoff",
    wFeedback: "feedback",
    wDamp: "damp",
    wReverb: "reverb",
    wDecay: "decay",
    wPattern: "pattern",
    wChord: "chord",
    wBreak: "breakdown",
  };
  Object.entries(weightMap).forEach(([id, key]) => {
    $(id).addEventListener("input", () => {
      state.weight[key] = Number($(id).value) / 100;
      $(id + "Val").textContent = $(id).value;
    });
  });
  bindSlider("drive", "driveVal", (el) => Number(el.value), (v) => { state.drive = v / 100; }, (v) => String(Math.round(v)));
  $("div").addEventListener("change", () => {
    state.delayBeats = Number($("div").value);
    applyParams();
  });

  $("record").addEventListener("click", () => {
    if (recording) stopRecording();
    else startRecording();
  });
  $("hideUi").addEventListener("click", () => document.body.classList.add("plate-only"));
  $("showUi").addEventListener("click", () => document.body.classList.remove("plate-only"));

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target === document.body) {
      e.preventDefault();
      $("play").click();
    }
  });

  document.querySelectorAll(".faders input[type=range]").forEach((input) => {
    const slot = document.createElement("span");
    slot.className = "fader";
    input.parentNode.insertBefore(slot, input);
    slot.appendChild(input);
    const setFromY = (clientY) => {
      const rect = slot.getBoundingClientRect();
      const t = 1 - (clientY - rect.top) / rect.height;
      const min = Number(input.min);
      const max = Number(input.max);
      const step = Number(input.step) || 1;
      const clamped = Math.min(1, Math.max(0, t));
      const raw = min + clamped * (max - min);
      const stepped = Math.round((raw - min) / step) * step + min;
      input.value = String(Math.min(max, Math.max(min, stepped)));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    slot.addEventListener("pointerdown", (e) => {
      slot.setPointerCapture(e.pointerId);
      setFromY(e.clientY);
      e.preventDefault();
    });
    slot.addEventListener("pointermove", (e) => {
      if (slot.hasPointerCapture(e.pointerId)) setFromY(e.clientY);
    });
  });

  draw();
}

wire();
