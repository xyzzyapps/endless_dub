/* One mix callback. Voices are ordinary oscillators and biquads, not AudioNodes. */
class DubEngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    this.p = {
      playing: 0, bpm: 122, swing: 0.14, root: 50, semi: 0,
      notes: [50, 57, 65, 64], cutoff: 680, reso: 6, decay: 0.28,
      send: 0.62, feedback: 0.7, damp: 1400, reverb: 0.34, drive: 0.22,
      width: 0.68, bass: 0.78, tension: 1, ring: 1.8, order: 6, breakdown: 0,
      lvl: { kick: 1, hat: 1, open: 0.85, snare: 1, rim: 1, stab: 1, plate: 0 },
      len: { kick: 0.42, hat: 0.03, open: 0.22, snare: 0.14, rim: 0.07, bass: 0.55 },
      mute: {},
      patterns: {},
    };
    this.step = 0;
    this.next = 0;
    this.voices = [];
    this.rng = 1;
    this.duck = 1;
    this.duckAge = 1;
    this.comp = 0;
    this.sideLp = 0;
    const n = Math.ceil(this.sr * 2);
    this.dl = new Float32Array(n);
    this.dr = new Float32Array(n);
    this.di = 0;
    this.dSamp = this.sr * 0.37;
    this.lpL = 0;
    this.lpR = 0;
    this.dampL = new Float32Array(4);
    this.dampR = new Float32Array(4);
    this.pre = new Float32Array(4);
    this.combs = [0.037, 0.041, 0.043, 0.047, 0.053, 0.059].map((sec, i) => ({
      buf: new Float32Array(Math.max(32, (this.sr * sec) | 0) + (i % 2) * 17),
      i: 0,
      lp: 0,
    }));
    this.aps = [0.0053, 0.0037].map((sec) => ({
      buf: new Float32Array(Math.max(16, (this.sr * sec) | 0)),
      i: 0,
    }));
    this.port.onmessage = (event) => {
      if (!event.data || event.data.type !== "sync") return;
      const was = this.p.playing;
      this.p = event.data;
      if (!was && this.p.playing) {
        this.step = 0;
        this.next = 0;
      }
    };
  }

  noise() {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return (this.rng >>> 8) / 16777216 * 2 - 1;
  }

  midi(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  biq() {
    return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 };
  }

  setMode(b, freq, q, mode) {
    const sr = this.sr;
    freq = Math.max(20, Math.min(freq, sr * 0.45));
    q = Math.max(0.05, q);
    const w = 2 * Math.PI * freq / sr;
    const c = Math.cos(w);
    const s = Math.sin(w);
    const alpha = s / (2 * q);
    const a0 = 1 + alpha;
    if (mode === "hp") {
      b.b0 = ((1 + c) / 2) / a0;
      b.b1 = -(1 + c) / a0;
      b.b2 = b.b0;
    } else if (mode === "bp") {
      b.b0 = alpha / a0;
      b.b1 = 0;
      b.b2 = -alpha / a0;
    } else {
      b.b0 = ((1 - c) / 2) / a0;
      b.b1 = (1 - c) / a0;
      b.b2 = b.b0;
    }
    b.a1 = (-2 * c) / a0;
    b.a2 = (1 - alpha) / a0;
  }

  tick(b, x) {
    const y = b.b0 * x + b.z1;
    b.z1 = b.b1 * x - b.a1 * y + b.z2;
    b.z2 = b.b2 * x - b.a2 * y;
    return y;
  }

  env(age, attack, release) {
    if (age < 0) return 0;
    if (age < attack) return age / attack;
    if (age >= attack + release) return 0;
    return Math.exp(-6 * (age - attack) / Math.max(0.01, release));
  }

  /* BiquadFilterNode coefficients from the Web Audio spec (Audio EQ Cookbook). */
  biqCoeff(type, freq, q) {
    const sr = this.sr;
    freq = Math.max(10, Math.min(freq, sr * 0.49));
    q = Math.max(0.0001, q);
    const w0 = 2 * Math.PI * freq / sr;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    const alpha = sin / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === "hp") {
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
    } else if (type === "bp") {
      b0 = alpha; b1 = 0; b2 = -alpha;
    } else {
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
    }
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  biqRun(mem, base, c, x) {
    const y = c.b0 * x + c.b1 * mem[base] + c.b2 * mem[base + 1] - c.a1 * mem[base + 2] - c.a2 * mem[base + 3];
    mem[base + 1] = mem[base];
    mem[base] = x;
    mem[base + 3] = mem[base + 2];
    mem[base + 2] = y;
    return y;
  }

  /* GainNode exponentialRamp between 0.0001 and peak, same shape as envGain(). */
  ramp(age, attack, hold, release, peak) {
    const level = Math.max(0.0001, peak);
    if (age < 0) return 0;
    if (age < attack) return 0.0001 * Math.pow(level / 0.0001, age / Math.max(0.0001, attack));
    if (age < attack + hold) return level;
    if (age >= attack + hold + release) return 0;
    const t = (age - attack - hold) / Math.max(0.0001, release);
    return level * Math.pow(0.0001 / level, t);
  }

  saw(phase, dt) {
    let y = 2 * phase - 1;
    if (phase < dt) {
      const x = phase / dt;
      y -= x + x - x * x - 1;
    } else if (phase > 1 - dt) {
      const x = (phase - 1) / dt;
      y -= x * x + x + x + 1;
    }
    return y;
  }

  spawn(v) {
    if (this.voices.length > 64) this.voices.shift();
    this.voices.push(v);
  }

  hit(step) {
    const p = this.p;
    const pat = p.patterns || {};
    const mute = p.mute || {};
    const lvl = p.lvl || {};
    const len = p.len || {};
    const broken = p.breakdown > 0;
    const on = (id) => pat[id] && pat[id][step] && !mute[id];
    const swingWait = (step % 2 === 1) ? ((60 / p.bpm) / 4) * p.swing : 0;
    if (on("kick") && !broken) {
      this.spawn({
        kind: "kick", age: 0, dur: len.kick || 0.42, amp: 0.95 * (lvl.kick || 0),
        phase: 0, f: this.biq(),
      });
      this.setMode(this.voices[this.voices.length - 1].f, 1800, 0.7, "hp");
      this.duck = 0.62;
      this.duckAge = 0;
    }
    if (on("hat") && this.noise() * 0.5 + 0.5 < (broken ? 0.45 : 0.92)) {
      const v = { kind: "hat", age: -swingWait, dur: len.hat || 0.03, amp: 0.07 * (lvl.hat || 0), f: this.biq() };
      this.setMode(v.f, 8000, 0.55, "hp");
      this.spawn(v);
    }
    if (on("open") && this.noise() * 0.5 + 0.5 < (broken ? 0.4 : 1)) {
      const v = { kind: "open", age: -swingWait, dur: len.open || 0.22, amp: 0.16 * (lvl.open || 0), f: this.biq(), f2: this.biq() };
      this.setMode(v.f, 5200, 0.55, "hp");
      this.setMode(v.f2, 9000, 0.7, "bp");
      this.spawn(v);
    }
    if (on("snare") && !broken) {
      const v = {
        kind: "snare", age: 0, dur: len.snare || 0.14, amp: lvl.snare || 0,
        phase: 0, bursts: [this.biq(), this.biq(), this.biq()], send: this.biq(),
      };
      v.bursts.forEach((b) => this.setMode(b, 1800, 0.8, "bp"));
      this.setMode(v.send, 2500, 0.5, "hp");
      this.spawn(v);
    }
    if (on("perc") && !broken) {
      const v = { kind: "rim", age: 0, dur: len.rim || 0.07, amp: lvl.rim || 0, phase: 0, phase2: 0, f: this.biq() };
      this.setMode(v.f, 1800, 1.2, "bp");
      this.spawn(v);
    }
    if (on("bass") && !broken) {
      let note = p.root - 24;
      if (step === 8 || step === 10) note += 7;
      if (step % 7 === 6) note += this.noise() < 0 ? 0 : 7;
      const v = {
        kind: "bass", age: 0, dur: len.bass || 0.55, amp: 0.55 * (p.bass || 0),
        phase: 0, phase2: 0, freq: this.midi(note), f: this.biq(),
      };
      this.setMode(v.f, 220, 0.7, "lp");
      this.spawn(v);
    }
    if (on("stab")) {
      const notes = (p.notes && p.notes.length) ? p.notes : [p.root + p.semi];
      const nOsc = notes.length * 3;
      const burst = this.biq();
      this.setMode(burst, 900, 0.8, "bp");
      const decay = p.decay || 0.28;
      const start = Math.min(4200, p.cutoff * (2.4 + p.reso / 10));
      this.spawn({
        kind: "stab", age: 0, dur: decay, amp: 0.11 * (lvl.stab || 0),
        notes, phases: new Float32Array(nOsc),
        fz: new Float32Array(nOsc * 8),
        start, end1: Math.max(80, p.cutoff * 0.55), end2: Math.max(90, p.cutoff * 0.45),
        burst,
      });
    }
    if (on("plate") && (lvl.plate || 0) > 0.001) {
      const f0 = this.midi(p.root + 12) * (p.tension || 1);
      const order = Math.max(1, Math.min(10, p.order || 6));
      const modes = [[1, 2], [2, 1], [2, 2], [1, 3], [3, 1], [3, 2], [2, 3], [3, 3], [1, 4], [4, 1]];
      const fund = Math.sqrt(5);
      const freqs = [];
      for (let i = 0; i < order; i++) {
        const ratio = Math.sqrt(modes[i][0] ** 2 + modes[i][1] ** 2) / fund;
        freqs.push(Math.min(f0 * ratio, 12000));
      }
      const burst = this.biq();
      this.setMode(burst, Math.min(f0 * 3, 8000), 1.4, "bp");
      this.spawn({
        kind: "plate", age: 0, dur: p.ring || 1.8, amp: 0.07 * (lvl.plate || 0),
        phases: new Float32Array(freqs.length), freqs, burst,
      });
    }
  }

  renderVoice(v, bus) {
    const dt = 1 / this.sr;
    v.age += dt;
    if (v.age < 0) return;
    if (v.kind === "kick") {
      const g = this.env(v.age, 0.004, v.dur);
      if (g === 0 && v.age > 0.01) { v.dead = 1; return; }
      const f = 46 + (165 - 46) * Math.exp(-v.age / 0.045);
      v.phase += f / this.sr;
      if (v.phase >= 1) v.phase -= 1;
      const body = Math.sin(v.phase * 6.2831853);
      let click = 0;
      if (v.age < 0.018) click = this.tick(v.f, this.noise()) * (1 - v.age / 0.018) * 0.28 * (v.amp / 0.95);
      bus.drum += (body * v.amp + click) * (g || (v.age < 0.018 ? 1 : 0));
      return;
    }
    if (v.kind === "hat" || v.kind === "open") {
      const g = this.env(v.age, 0.002, v.dur);
      if (g === 0) { v.dead = 1; return; }
      bus.drum += this.tick(v.f, this.noise()) * v.amp * g;
      if (v.f2) bus.drum += this.tick(v.f2, this.noise()) * v.amp * 0.3 * this.env(v.age, 0.002, v.dur * 0.7);
      return;
    }
    if (v.kind === "snare") {
      const g = this.env(v.age, 0.002, v.dur);
      if (g === 0 && v.age > v.dur) { v.dead = 1; return; }
      const f = 196 * Math.pow(150 / 196, Math.min(1, v.age / Math.min(0.12, v.dur)));
      v.phase += f / this.sr;
      if (v.phase >= 1) v.phase -= 1;
      const tri = v.phase < 0.5 ? (4 * v.phase - 1) : (3 - 4 * v.phase);
      bus.drum += tri * 0.28 * v.amp * g;
      v.bursts.forEach((b, i) => {
        const start = i * 0.012;
        if (v.age < start) return;
        const ng = this.env(v.age - start, 0.002, Math.max(0.02, v.dur * (0.7 - i * 0.15)));
        bus.drum += this.tick(b, this.noise()) * (0.22 - i * 0.04) * v.amp * ng;
      });
      const sg = this.env(v.age, 0.002, v.dur * 0.8);
      bus.send += this.tick(v.send, this.noise()) * 0.16 * v.amp * sg;
      return;
    }
    if (v.kind === "rim") {
      const g = this.env(v.age, 0.001, v.dur);
      if (g === 0) { v.dead = 1; return; }
      v.phase += 380 / this.sr;
      v.phase2 += 640 / this.sr;
      if (v.phase >= 1) v.phase -= 1;
      if (v.phase2 >= 1) v.phase2 -= 1;
      const t1 = v.phase < 0.5 ? (4 * v.phase - 1) : (3 - 4 * v.phase);
      const t2 = v.phase2 < 0.5 ? (4 * v.phase2 - 1) : (3 - 4 * v.phase2);
      bus.drum += (t1 * 0.18 + t2 * 0.1) * v.amp * g;
      const ng = this.env(v.age, 0.001, Math.min(0.04, v.dur));
      bus.drum += this.tick(v.f, this.noise()) * 0.08 * v.amp * ng;
      return;
    }
    if (v.kind === "bass") {
      const g = this.env(v.age, 0.012, v.dur);
      const g2 = this.env(v.age, 0.02, v.dur * 1.15);
      if (g === 0 && g2 === 0) { v.dead = 1; return; }
      v.phase += v.freq / this.sr;
      v.phase2 += (v.freq * 0.5) / this.sr;
      if (v.phase >= 1) v.phase -= 1;
      if (v.phase2 >= 1) v.phase2 -= 1;
      const s = Math.sin(v.phase * 6.2831853);
      const sub = Math.sin(v.phase2 * 6.2831853);
      bus.music += this.tick(v.f, s) * v.amp * g + sub * v.amp * 0.82 * g2;
      return;
    }
    if (v.kind === "stab") {
      if (this.p.mute && this.p.mute.stab) { v.dead = 1; return; }
      const ng = this.env(v.age, 0.002, 0.06);
      if (v.age > v.dur + 0.08 && ng === 0) { v.dead = 1; return; }
      const p = this.p;
      const k = Math.min(1, v.age / Math.max(0.05, v.dur));
      const f1 = v.start * Math.pow(v.end1 / Math.max(1, v.start), k);
      const f2 = (v.start * 0.85) * Math.pow(v.end2 / Math.max(1, v.start * 0.85), k);
      const q1 = 0.4 + (p.reso || 0) / 10;
      const c1 = this.biqCoeff("lp", f1, q1);
      const c2 = this.biqCoeff("lp", f2, 0.6);
      let s = 0;
      v.notes.forEach((note, idx) => {
        [-7, 0, 6].forEach((cents, c) => {
          const n = idx * 3 + c;
          const freq = this.midi(note) * Math.pow(2, (cents + (idx - 1) * 2) / 1200);
          const inc = freq / this.sr;
          v.phases[n] += inc;
          if (v.phases[n] >= 1) v.phases[n] -= 1;
          let y = this.biqRun(v.fz, n * 8, c1, this.saw(v.phases[n], inc));
          y = this.biqRun(v.fz, n * 8 + 4, c2, y);
          s += y;
        });
      });
      const y = s * this.ramp(v.age, 0.008, 0.02, v.dur, v.amp);
      bus.music += y;
      bus.send += y;
      bus.rev += y * 0.45;
      if (ng) bus.send += this.tick(v.burst, this.noise()) * 0.05 * ng;
      return;
    }
    if (v.kind === "plate") {
      if ((this.p.mute && this.p.mute.plate) || (this.p.lvl && (this.p.lvl.plate || 0) <= 0.001)) {
        v.dead = 1;
        return;
      }
      let any = 0;
      const fund = v.freqs[0] || 1;
      v.freqs.forEach((freq, i) => {
        const ratio = freq / fund;
        const g = this.env(v.age, 0.002, v.dur / Math.max(0.4, ratio));
        if (!g) return;
        any = 1;
        v.phases[i] += freq / this.sr;
        if (v.phases[i] >= 1) v.phases[i] -= 1;
        const s = Math.sin(v.phases[i] * 6.2831853) * v.amp / (1 + i * 0.45) * g;
        bus.music += s;
        bus.rev += s;
        bus.send += s * 0.35;
      });
      const ng = this.env(v.age, 0.002, 0.025);
      if (ng) bus.music += this.tick(v.burst, this.noise()) * v.amp * 2.2 * ng;
      if (!any && !ng) v.dead = 1;
    }
  }

  comb(c, x, fb) {
    const y = c.buf[c.i];
    c.lp += 0.08 * (y - c.lp);
    c.buf[c.i] = x + c.lp * fb;
    c.i += 1;
    if (c.i >= c.buf.length) c.i = 0;
    return y;
  }

  allpass(a, x) {
    const buf = a.buf[a.i];
    const y = -x + buf;
    a.buf[a.i] = x + buf * 0.5;
    a.i += 1;
    if (a.i >= a.buf.length) a.i = 0;
    return y;
  }

  process(_inputs, outputs) {
    const outL = outputs[0][0];
    const outR = outputs[0][1] || outL;
    const n = outL.length;
    const p = this.p;
    const sixteenth = this.sr * 60 / Math.max(1, p.bpm) / 4;
    const bpm = Math.max(1, p.bpm);
    for (let i = 0; i < n; i++) {
      if (p.playing && this.next <= 0) {
        const step = this.step;
        this.hit(step);
        this.step = (step + 1) % 16;
        this.next += sixteenth;
        const bar = this.step === 0;
        this.port.postMessage({ type: "step", step, bar });
      }
      if (p.playing) this.next -= 1;
      this.duckAge += 1 / this.sr;
      if (this.duckAge > 0.03) this.duck += (1 - this.duck) * 0.00011;

      const bus = { drum: 0, music: 0, send: 0, rev: 0 };
      for (let v = 0; v < this.voices.length; v++) this.renderVoice(this.voices[v], bus);
      if (this.voices.length && this.voices.some((v) => v.dead)) {
        this.voices = this.voices.filter((v) => !v.dead);
      }

      const send = Math.max(-1, Math.min(1, bus.send * p.send));
      const target = this.sr * 60 / bpm * 0.75;
      this.dSamp += (target - this.dSamp) * 0.001;
      let read = this.di - this.dSamp;
      const len = this.dl.length;
      read %= len;
      if (read < 0) read += len;
      const i0 = read | 0;
      const i1 = (i0 + 1) % len;
      const fr = read - i0;
      const wetL = this.dl[i0] * (1 - fr) + this.dl[i1] * fr;
      const wetR = this.dr[i0] * (1 - fr) + this.dr[i1] * fr;
      const dampC = this.biqCoeff("lp", Math.max(80, p.damp), 1);
      this.lpL = this.biqRun(this.dampL, 0, dampC, wetL);
      this.lpR = this.biqRun(this.dampR, 0, dampC, wetR);
      const fb = Math.min(0.88, p.feedback || 0);
      this.dl[this.di] = send + this.lpR * fb;
      this.dr[this.di] = this.lpL * fb;
      this.di += 1;
      if (this.di >= len) this.di = 0;

      const preC = this.biqCoeff("lp", 2800, 1);
      const revIn = this.biqRun(this.pre, 0, preC, bus.rev) * p.reverb * 0.7 * 0.9;
      let room = 0;
      for (let c = 0; c < this.combs.length; c++) room += this.comb(this.combs[c], revIn, 0.55);
      room /= this.combs.length;
      for (let c = 0; c < this.aps.length; c++) room = this.allpass(this.aps[c], room);

      let l = bus.drum * 0.9 + (bus.music + wetL * 0.85 + room) * this.duck;
      let r = bus.drum * 0.9 + (bus.music + wetR * 0.85 + room * 0.92) * this.duck;
      const amt = 1 + (p.drive || 0) * 10;
      const norm = Math.tanh(amt);
      l = Math.tanh(l * amt) / norm;
      r = Math.tanh(r * amt) / norm;
      const env = Math.max(Math.abs(l), Math.abs(r));
      this.comp += (env - this.comp) * (env > this.comp ? 0.02 : 0.0008);
      const thr = 0.316;
      let cg = 1;
      if (this.comp > thr) cg = (thr + (this.comp - thr) / 3.2) / this.comp;
      l *= cg;
      r *= cg;
      const mid = 0.5 * (l + r);
      let side = 0.5 * (l - r);
      const hp = 1 - Math.exp((-2 * Math.PI * 220) / this.sr);
      this.sideLp += hp * (side - this.sideLp);
      side = (side - this.sideLp) * (p.width || 0) * 2.2;
      l = (mid + side) * 0.85;
      r = (mid - side) * 0.85;
      if (l > 1) l = 1;
      if (l < -1) l = -1;
      if (r > 1) r = 1;
      if (r < -1) r = -1;
      outL[i] = l;
      outR[i] = r;
    }
    return true;
  }
}

registerProcessor("dub-engine", DubEngineProcessor);
