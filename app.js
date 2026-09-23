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
};

const $ = (id) => document.getElementById(id);

let ctx, master, drumBus, musicBus, duck, delaySend, reverbSend;
let delayL, delayR, fbL, fbR, dampL, dampR;
let comp, shaper, analyser;
let noiseBuf;
let timer;
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

function makePattern() {
  const kick = Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? 1 : 0));
  if (Math.random() < 0.35) kick[8] = 0;

  const hat = Array.from({ length: 16 }, (_, i) => {
    if (i % 2 === 0) return Math.random() < 0.35 ? 1 : 0;
    return Math.random() < 0.72 ? 1 : 0;
  });
  hat[0] = 0;

  const open = Array(16).fill(0);
  const openAt = [6, 10, 14][Math.floor(Math.random() * 3)];
  open[openAt] = 1;
  if (Math.random() < 0.35) open[(openAt + 8) % 16] = 1;

  const snare = Array(16).fill(0);
  snare[4] = 1;
  snare[12] = 1;
  if (Math.random() < 0.3) snare[13] = 1;

  const perc = Array(16).fill(0);
  perc[6] = 1;
  if (Math.random() < 0.7) perc[14] = 1;
  if (Math.random() < 0.25) perc[10] = 1;

  const bass = Array(16).fill(0);
  bass[0] = 1;
  const off = [6, 7, 10, 14][Math.floor(Math.random() * 4)];
  bass[off] = 1;
  if (Math.random() < 0.4) bass[8] = 1;

  const stab = Array(16).fill(0);
  const candidates = [3, 6, 7, 10, 11, 14];
  const hits = 2 + Math.floor(Math.random() * 2);
  const picked = candidates.sort(() => Math.random() - 0.5).slice(0, hits);
  picked.forEach((i) => { stab[i] = 1; });
  if (Math.random() < 0.55) stab[3] = 1;

  const plate = Array(16).fill(0);
  const plateAt = [2, 7, 10, 11, 15][Math.floor(Math.random() * 5)];
  plate[plateAt] = 1;
  if (Math.random() < 0.4) plate[(plateAt + 8) % 16] = 1;

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
    if (d.cutoff) state.cutoff = clamp(state.cutoff + (Math.random() * 280 - 140), 220, 1800);
    if (d.feedback) state.feedback = clamp(state.feedback + (Math.random() * 0.1 - 0.04), 0.45, 0.84);
    if (d.damp) state.damp = clamp(state.damp + (Math.random() * 700 - 350), 500, 4200);
    if (d.reverb) state.reverb = clamp(state.reverb + (Math.random() * 0.16 - 0.08), 0.05, 0.8);
    if (d.decay) state.decay = clamp(state.decay + (Math.random() * 0.16 - 0.08), 0.09, 0.8);
    syncControls();
    applyParams();
  }
  if (state.bar % 16 === 0 && state.drift.pattern) {
    mutatePattern();
    paintGrids();
  }
  if (state.drift.chord && state.holdBars >= state.minHold && state.bar % 16 === 0 && Math.random() < 0.65) {
    shiftChord();
  }
  if (state.drift.breakdown && state.bar % 32 === 0 && Math.random() < 0.7) {
    state.breakdown = 4;
    if (state.drift.feedback) {
      state.feedback = Math.min(0.86, state.feedback + 0.08);
      applyParams();
    }
  }
}

function mutatePattern() {
  const hat = state.patterns.hat;
  const i = 1 + Math.floor(Math.random() * 15);
  hat[i] = hat[i] ? 0 : 1;
  if (Math.random() < 0.4) {
    const open = state.patterns.open;
    const idx = [2, 6, 10, 14][Math.floor(Math.random() * 4)];
    open[idx] = open[idx] ? 0 : 1;
    if (open.reduce((a, b) => a + b, 0) > 3) open[idx] = 0;
  }
  const stab = state.patterns.stab;
  if (Math.random() < 0.5) {
    const idx = [3, 6, 7, 10, 11, 14][Math.floor(Math.random() * 6)];
    stab[idx] = stab[idx] ? 0 : 1;
    if (stab.reduce((a, b) => a + b, 0) < 2) stab[3] = 1;
    if (stab.reduce((a, b) => a + b, 0) > 4) stab[idx] = 0;
  }
  const kick = state.patterns.kick;
  if (Math.random() < 0.4) kick[8] = kick[8] ? 0 : 1;
  kick[0] = 1;
  const snare = state.patterns.snare;
  snare[4] = 1;
  snare[12] = 1;
  if (Math.random() < 0.35) snare[13] = snare[13] ? 0 : 1;
  if (Math.random() < 0.45) {
    const plate = state.patterns.plate;
    const idx = [2, 7, 10, 11, 15][Math.floor(Math.random() * 5)];
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

function applyBase(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  state.color = { hex, r, g, b };
  const mix = (t, target) => Math.round(r + (target - r) * t).toString(16).padStart(2, "0")
    + Math.round(g + (target - g) * t).toString(16).padStart(2, "0")
    + Math.round(b + (target - b) * t).toString(16).padStart(2, "0");
  const root = document.documentElement.style;
  root.setProperty("--accent", hex);
  root.setProperty("--on", hex);
  root.setProperty("--accent-rgb", r + ", " + g + ", " + b);
  root.setProperty("--glow", "#" + mix(0.45, 255));
  root.setProperty("--line", "#" + mix(0.72, 0));
}

function scheduler() {
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
  const w = Math.max(180, Math.round(window.innerWidth / 5));
  const h = Math.max(100, Math.round(window.innerHeight / 5));
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
      const col = state.color;
      data[p] = 4 + sand * col.r;
      data[p + 1] = 8 + sand * col.g;
      data[p + 2] = 12 + sand * col.b;
      data[p + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
}

function draw(now) {
  requestAnimationFrame(draw);
  drawPlate(now || performance.now());
  const canvas = $("scope");
  const c = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  c.fillStyle = "#01070f";
  c.fillRect(0, 0, w, h);
  if (!analyser) {
    c.strokeStyle = `rgb(${Math.round(state.color.r * 0.28)}, ${Math.round(state.color.g * 0.28)}, ${Math.round(state.color.b * 0.28)})`;
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
  $("keyName").textContent = chordName();

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

  bindSlider("cutoff", "cutoffVal", (el) => Number(el.value), (v) => { state.cutoff = v; }, (v) => String(Math.round(v)));
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
  bindSlider("drive", "driveVal", (el) => Number(el.value), (v) => { state.drive = v / 100; }, (v) => String(Math.round(v)));
  $("div").addEventListener("change", () => {
    state.delayBeats = Number($("div").value);
    applyParams();
  });

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target === document.body) {
      e.preventDefault();
      $("play").click();
    }
  });

  draw();
}

wire();
