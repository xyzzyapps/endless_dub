import { Csound } from "./csound.js";

const VOICE = ["kick", "hat", "open", "snare", "perc", "bass", "stab", "plate"];



const api = { on: false, step: 0, context: null, master: null, analyser: null };
let csound = null;
let poll = 0;


function impulseTables() {
  const length = 48000 * 3.2;
  const left = new Float32Array(262144);
  const right = new Float32Array(262144);
  let power = 0;
  for (let i = 0; i < length; i++) {
    const decay = Math.pow(1 - i / length, 2.4);
    const l = (Math.random() * 2 - 1) * decay;
    const r = (Math.random() * 2 - 1) * decay;
    left[i] = l;
    right[i] = r;
    power += l * l + r * r;
  }
  const scale = 1 / Math.sqrt(power);
  for (let i = 0; i < length; i++) {
    left[i] *= scale;
    right[i] *= scale;
  }
  return [left, right];
}

function mask(row) {
  let bits = 0;
  for (let i = 0; i < 16; i++) if (row && row[i]) bits |= 1 << i;
  return bits;
}

async function push(state) {
  if (!csound) return;
  const notes = (typeof stabNotes === "function") ? stabNotes() : [state.root, state.root, state.root, state.root];
  const sets = [
    ["playing", state.playing ? 1 : 0],
    ["bpm", state.bpm],
    ["swing", state.swing],
    ["break", state.breakdown > 0 ? 1 : 0],
    ["root", state.root],
    ["cutoff", state.cutoff],
    ["reso", state.reso],
    ["decay", state.decay],
    ["feedback", Math.min(0.88, state.feedback)],
    ["damp", state.damp],
    ["send", state.send],
    ["reverb", state.reverb],
    ["drive", state.drive],
    ["div", state.delayBeats || 0.75],
    ["srs", state.srs],
    ["tension", state.plate.tension || 1],
    ["order", state.plate.order || 6],
    ["ring", state.plate.ring],
    ["n0", notes[0] || state.root],
    ["n1", notes[1] || state.root],
    ["n2", notes[2] || state.root],
    ["n3", notes[3] || state.root],
  ];
  VOICE.forEach((id, i) => {
    const key = id === "perc" ? "rim" : id;
    const level = id === "bass" ? state.bassLvl : (state.lvl[key] || 0);
    sets.push(["lvl" + i, level], ["mute" + i, state.mute[key] ? 1 : 0], ["mask" + i, mask(state.patterns[id])]);
  });
  ["kick", "hat", "open", "snare", "rim", "bass"].forEach((id, i) => sets.push(["len" + i, state.len[id] || 0.1]));
  await Promise.all(sets.map(([name, value]) => csound.setControlChannel(name, value)));
}

async function boot(state) {
  if (csound) return;
  const context = new AudioContext();
  csound = await Csound({
    audioContext: context,
    outputChannelCount: 2,
    inputChannelCount: 0,
    autoConnect: true,
  });
  const messages = [];
  csound.on("message", (msg) => messages.push(String(msg)));
  await csound.setOption("-odac");
  const build = (document.querySelector('meta[name="build"]') || {}).content || "";
  const orcUrl = new URL("./graph.orc" + (build && build !== "dev" ? "?v=" + build : ""), import.meta.url);
  const orc = await (await fetch(orcUrl)).text();
  const compiled = await csound.compileOrc(orc);
  if (compiled !== 0) throw new Error(messages.join("\n") || ("Csound orchestra did not compile (" + compiled + ")"));
  const [left, right] = impulseTables();
  await csound.tableCopyIn("20", left);
  await csound.tableCopyIn("21", right);
  await csound.readScore("i 1 0 86400\ni 99 0 86400\n");
  await csound.start();
  api.context = context;
  api.master = await csound.getNode();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.35;
  if (api.master) api.master.connect(analyser);
  api.analyser = analyser;
  api.on = true;
  await push(state);
}

api.sync = function (state) {
  if (api.on) push(state);
};

api.toggle = async function (state) {
  await boot(state);
  if (api.context.state === "suspended") await api.context.resume();
  state.playing = !state.playing;
  await push(state);
  if (state.playing && !poll) {
    poll = setInterval(async () => {
      push(state);
      const step = await csound.getControlChannel("step");
      if (typeof step === "number" && isFinite(step)) {
        const wrapped = state.playing && step < api.step;
        api.step = step;
        state.step = step;
        if (wrapped && typeof onBar === "function") {
          onBar();
          push(state);
        }
      }
    }, 50);
  }
  if (!state.playing) {
    clearInterval(poll);
    poll = 0;
  }
  return state.playing;
};

window.CsoundDub = api;
