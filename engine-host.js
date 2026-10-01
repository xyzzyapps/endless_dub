/* Boots the mix worklet and keeps it fed from the page state. */
(function () {
  const api = { on: false, step: 0, context: null, master: null, analyser: null };
  let node = null;
  let timer = 0;

  function pack(state) {
    let notes = [state.root];
    if (typeof stabNotes === "function") {
      try { notes = stabNotes(); } catch (ignore) { notes = [state.root]; }
    }
    return {
      type: "sync",
      playing: state.playing ? 1 : 0,
      bpm: state.bpm,
      swing: state.swing,
      root: state.root,
      semi: (typeof currentChord === "function") ? currentChord().semi : 0,
      notes,
      cutoff: state.cutoff,
      reso: state.reso,
      decay: state.decay,
      send: state.send,
      feedback: state.feedback,
      damp: state.damp,
      reverb: state.reverb,
      drive: state.drive,
      width: state.srs,
      bass: state.bassLvl,
      tension: state.plate.tension,
      ring: state.plate.ring,
      order: state.plate.order,
      breakdown: state.breakdown > 0 ? 1 : 0,
      lvl: state.lvl,
      len: state.len,
      mute: state.mute,
      patterns: state.patterns,
    };
  }

  async function boot(state) {
    if (node) return;
    const ctx = new AudioContext();
    const build = (document.querySelector('meta[name="build"]') || {}).content || "dev";
    const q = build === "dev" ? "" : ("?v=" + build);
    await ctx.audioWorklet.addModule("engine-worklet.js" + q);
    node = new AudioWorkletNode(ctx, "dub-engine", { outputChannelCount: [2] });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.35;
    const master = ctx.createGain();
    master.gain.value = 1;
    node.connect(analyser);
    analyser.connect(master);
    master.connect(ctx.destination);
    node.port.onmessage = (event) => {
      if (!event.data || event.data.type !== "step") return;
      api.step = event.data.step;
      state.step = event.data.step;
      if (event.data.bar && typeof onBar === "function") {
        onBar();
        api.sync(state);
      }
    };
    api.context = ctx;
    api.master = master;
    api.analyser = analyser;
    api.on = true;
  }

  api.sync = function (state) {
    if (node) node.port.postMessage(pack(state));
  };

  api.toggle = async function (state) {
    await boot(state);
    if (api.context.state === "suspended") await api.context.resume();
    state.playing = !state.playing;
    if (state.playing) {
      state.step = 0;
      api.step = 0;
    }
    api.sync(state);
    if (state.playing && !timer) timer = setInterval(() => api.sync(state), 40);
    if (!state.playing) {
      clearInterval(timer);
      timer = 0;
      api.step = 0;
    }
    return state.playing;
  };

  window.DubEngine = api;
})();
