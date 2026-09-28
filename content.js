(() => {
  "use strict";
  if (document.querySelector("yt-audio-meter")) return;

  const host = document.createElement("yt-audio-meter");
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; position: absolute; top: 16px; right: 16px; z-index: 2147483646;
      display: block; width: min(280px, calc(100% - 32px)); color-scheme: dark; }
    :host([left]) { right: auto; left: 16px; }
    * { box-sizing: border-box; }
    section { font: 12px/1.4 system-ui, sans-serif; color: #edf1f7; background: #10151eef;
      border: 1px solid #ffffff26; border-radius: 12px; padding: 12px 14px;
      box-shadow: 0 4px 20px #0005; user-select: none; }
    header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    strong { font-size: 11px; letter-spacing: 1.4px; flex: 1; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #738096; }
    section[data-active=true] .dot { background: #56e5a0; box-shadow: 0 0 8px #56e5a050; }
    button { border: 1px solid #ffffff26; background: #ffffff0c; color: #edf1f7;
      border-radius: 6px; font: inherit; padding: 4px 8px; cursor: pointer; }
    button:hover { background: #ffffff20; }
    button:focus-visible { outline: 2px solid #56e5a0; outline-offset: 2px; }
    .row { display: grid; grid-template-columns: 12px 1fr 42px; align-items: center;
      gap: 8px; margin: 7px 0; font-variant-numeric: tabular-nums; }
    .channel { color: #a7b3c4; font-size: 10px; }
    .track { position: relative; height: 10px; background: #ffffff0c; border-radius: 2px; overflow: hidden; }
    .fill { position: absolute; inset: 0; background: linear-gradient(to right,
      #41d98c 0%, #41d98c 70%, #f6c85c 80%, #f6c85c 90%, #ff646e 100%);
      clip-path: inset(0 100% 0 0); }
    .ticks { position: absolute; inset: 0; background: repeating-linear-gradient(to right,
      transparent 0, transparent calc(5% - 2px), #10151e 5%); }
    .peak { position: absolute; top: 0; bottom: 0; width: 2px; background: #fff; opacity: 0; }
    output { text-align: right; font: 10px ui-monospace, monospace; }
    .scale { display: flex; justify-content: space-between; margin: 3px 50px 9px 20px;
      color: #94a1b4; font: 9px ui-monospace, monospace; }
    .status { color: #bdc8d7; min-height: 17px; font-size: 11px; }
    footer { display: flex; align-items: center; justify-content: space-between; gap: 8px;
      border-top: 1px solid #ffffff16; padding-top: 9px; margin-top: 9px; }
    .max { color: #a7b3c4; font: 10px ui-monospace, monospace; }
    .reset { border: 0; padding: 0; background: none; text-align: left; }
    [hidden] { display: none !important; }
    :host([compact]) { width: auto; }
    :host([compact]) header { margin: 0; }
    :host([compact]) .details, :host([compact]) .position { display: none; }
  `;
  root.append(style);
  function element(tag, className, text, parent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  }
  const panel = element("section", "", "", root);
  panel.setAttribute("aria-label", "Vu-mètre audio YouTube");
  const header = element("header", "", "", panel);
  element("span", "dot", "", header);
  element("strong", "", "VU-MÈTRE", header);
  const position = element("button", "position", "↔", header);
  position.title = "Changer de côté";
  position.setAttribute("aria-label", position.title);
  position.onclick = () => host.toggleAttribute("left");
  const compact = element("button", "", "−", header);
  compact.title = "Réduire / agrandir";
  compact.setAttribute("aria-label", compact.title);
  compact.setAttribute("aria-expanded", "true");
  compact.onclick = () => {
    const collapsed = host.toggleAttribute("compact");
    compact.textContent = collapsed ? "+" : "−";
    compact.setAttribute("aria-expanded", String(!collapsed));
  };
  const details = element("div", "details", "", panel);
  const channels = ["G", "D"].map((label) => {
    const row = element("div", "row", "", details);
    element("span", "channel", label, row);
    const track = element("div", "track", "", row);
    const fill = element("div", "fill", "", track);
    element("div", "ticks", "", track);
    const peak = element("div", "peak", "", track);
    const value = element("output", "", "−∞", row);
    value.setAttribute("aria-label", `Niveau ${label === "G" ? "gauche" : "droit"} en dBFS`);
    return { fill, peak, value, displayed: -60, held: -60, holdUntil: 0 };
  });
  const scale = element("div", "scale", "", details);
  ["−60", "−40", "−20", "0"].forEach((label) => element("span", "", label, scale));
  const status = element("div", "status", "Cliquez sur Activer pour mesurer le son.", details);
  const footer = element("footer", "", "", details);
  const maximum = element("button", "max reset", "Crête : −∞ dBFS", footer);
  maximum.title = "Réinitialiser la crête maximale";
  const toggle = element("button", "", "Activer", footer);

  // captureStream taps the decoded audio BEFORE HTMLMediaElement.muted/volume.
  // No captured audio is connected to speakers; the YouTube player stays untouched.
  let video = null;
  let context = null;
  let stream = null;
  let source = null;
  let stereo = null;
  let splitter = null;
  let analysers = [];
  let buffers = [];
  let audioTrack = null;
  let enabled = false;
  let visible = false;
  let discoveryTimer = null;
  let failure = "";
  let maxPeak = -Infinity;
  let lastFrame = 0;
  let frame = 0;
  let mediaEvents = null;
  const db = (amplitude) => amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
  const percent = (value) => Math.min(100, Math.max(0, (value + 60) / 60 * 100));
  const format = (value) => Number.isFinite(value) && value > -100 ? value.toFixed(1) : "−∞";
  maximum.onclick = () => { maxPeak = -Infinity; };

  function disconnectAudio() {
    source?.disconnect();
    stereo?.disconnect();
    splitter?.disconnect();
    analysers.forEach((analyser) => analyser.disconnect());
    source = stereo = splitter = audioTrack = null;
    analysers = [];
    buffers = [];
  }
  function releaseCapture() {
    disconnectAudio();
    const previous = stream;
    stream = null;
    previous?.getTracks().forEach((track) => track.stop());
  }
  function connectAudio() {
    if (!stream || !context || !enabled) return;
    // Stop the unused captured video track to avoid needless video processing.
    stream.getVideoTracks().forEach((track) => track.stop());
    const track = stream.getAudioTracks().find((candidate) => candidate.readyState === "live");
    if (track === audioTrack) return;
    disconnectAudio();
    if (!track) return;
    audioTrack = track;
    source = context.createMediaStreamSource(new MediaStream([track]));
    stereo = context.createGain();
    stereo.channelCount = 2;
    stereo.channelCountMode = "explicit";
    stereo.channelInterpretation = "speakers";
    splitter = context.createChannelSplitter(2);
    // Speakers interpretation duplicates mono to both meters; stereo stays separate.
    source.connect(stereo);
    stereo.connect(splitter);
    analysers = channels.map((_, index) => {
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      splitter.connect(analyser, index);
      return analyser;
    });
    buffers = analysers.map((analyser) => new Float32Array(analyser.fftSize));
    track.addEventListener("ended", () => {
      if (audioTrack === track) disconnectAudio();
    }, { once: true });
  }
  function capture() {
    if (!visible || !enabled || !video || !context || video.readyState < 2 || failure) return;
    try {
      if (!stream) {
        stream = video.captureStream();
        stream.addEventListener("addtrack", connectAudio);
        stream.addEventListener("removetrack", connectAudio);
      }
      connectAudio();
    } catch (error) {
      releaseCapture();
      failure = error.name === "SecurityError" || error.name === "NotSupportedError"
        ? "Audio inaccessible (contenu protégé ou origine non autorisée)."
        : "Capture indisponible. Arrêtez puis réactivez le vu-mètre.";
      console.warn("[YouTube Vu-mètre]", error);
    }
  }
  function reset() {
    maxPeak = -Infinity;
    channels.forEach((channel) => { channel.displayed = channel.held = -60; channel.holdUntil = 0; });
  }
  function attach(next) {
    if (next === video) return;
    mediaEvents?.abort();
    releaseCapture();
    video = next;
    failure = "";
    reset();
    if (!video) { host.remove(); return; }
    mediaEvents = new AbortController();
    const options = { signal: mediaEvents.signal };
    video.addEventListener("emptied", () => { releaseCapture(); failure = ""; reset(); }, options);
    video.addEventListener("loadeddata", capture, options);
    video.addEventListener("playing", capture, options);
    capture();
  }
  function discover() {
    if (!visible) return;
    // Avoid the silent thumbnail previews on the YouTube homepage.
    const candidates = [...document.querySelectorAll("#movie_player video, #player video, ytd-reel-video-renderer[is-active] video")]
      .filter((candidate) => candidate.getBoundingClientRect().width > 0);
    const next = candidates.find((candidate) => !candidate.paused) || candidates[0] || null;
    attach(next);
    if (video) {
      const container = video.closest(".html5-video-player") || video.parentElement;
      if (host.parentElement !== container) container.append(host);
      capture();
    }
  }
  function render(now) {
    if (!visible) return;
    frame = requestAnimationFrame(render);
    if (now - lastFrame < 50) return;
    const elapsed = Math.min(0.25, (now - lastFrame) / 1000);
    lastFrame = now;
    const running = enabled && context?.state === "running" && video && !video.paused
      && !video.ended && video.readyState >= 2 && audioTrack?.readyState === "live" && !audioTrack.muted;
    channels.forEach((channel, index) => {
      let sum = 0;
      let peak = 0;
      const data = buffers[index];
      if (running && data) {
        analysers[index].getFloatTimeDomainData(data);
        for (const sample of data) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
      }
      const rmsDb = db(data ? Math.sqrt(sum / data.length) : 0);
      const peakDb = db(peak);
      maxPeak = Math.max(maxPeak, peakDb);
      channel.displayed = Math.max(-60, rmsDb, channel.displayed - elapsed * 28);
      if (peakDb >= channel.held) { channel.held = peakDb; channel.holdUntil = now + 1000; }
      else if (now > channel.holdUntil) channel.held = Math.max(-60, channel.held - elapsed * 20);
      channel.fill.style.clipPath = `inset(0 ${100 - percent(channel.displayed)}% 0 0)`;
      channel.peak.style.left = `calc(${percent(channel.held)}% - 2px)`;
      channel.peak.style.opacity = channel.held > -60 ? "1" : "0";
      channel.value.textContent = format(rmsDb);
    });
    panel.dataset.active = String(Boolean(running));
    maximum.textContent = `Crête : ${format(maxPeak)} dBFS`;
    maximum.style.color = maxPeak >= -1 ? "#ff858d" : "";
    const message = !enabled ? "Cliquez sur Activer pour mesurer le son."
      : failure || (context?.state !== "running" ? "Cliquez sur Reprendre pour activer l’analyse."
      : video?.ended ? "Vidéo terminée"
      : video?.paused ? "En pause"
      : !audioTrack ? "En attente d’une piste audio…"
      : !running ? "En attente du son…"
      : video.muted || video.volume === 0 ? "Son coupé · mesure active"
      : "Mesure active · niveau avant volume");
    if (status.textContent !== message) status.textContent = message;
    toggle.textContent = !enabled ? "Activer" : context?.state !== "running" ? "Reprendre" : "Arrêter";
  }
  toggle.onclick = () => {
    if (enabled && context?.state === "running") {
      enabled = false;
      releaseCapture();
      void context.suspend().catch(() => {});
      reset();
      return;
    }
    enabled = true;
    failure = "";
    try {
      context ??= new AudioContext();
      // Called directly from a real click to satisfy Chrome's audio activation policy.
      void context.resume().catch(() => { failure = "Activation audio impossible. Réessayez."; });
      capture();
    } catch (error) {
      failure = "Ce navigateur ne permet pas l’analyse audio.";
      console.warn("[YouTube Vu-mètre]", error);
    }
  };
  // Keep player shortcuts and click-to-pause from consuming meter interactions.
  for (const type of ["click", "dblclick", "pointerdown", "pointerup", "keydown", "keyup"]) {
    host.addEventListener(type, (event) => event.stopPropagation());
  }
  function setVisible(next) {
    if (visible === next) return;
    visible = next;
    if (visible) {
      // Always reopen the full panel, even if it was previously collapsed.
      host.removeAttribute("compact");
      compact.textContent = "−";
      compact.setAttribute("aria-expanded", "true");
      discover();
      discoveryTimer = setInterval(discover, 1000);
      frame = requestAnimationFrame(render);
    } else {
      enabled = false;
      clearInterval(discoveryTimer);
      discoveryTimer = null;
      cancelAnimationFrame(frame);
      attach(null);
      host.remove();
      if (context?.state === "running") void context.suspend().catch(() => {});
    }
  }
  // Listen before requesting initial state so a toolbar click during page load
  // cannot be overwritten by an older initialization response.
  let visibilityReceived = false;
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === "VU_METER_PING") respond({ ready: true });
    if (message?.type === "VU_METER_VISIBILITY") {
      visibilityReceived = true;
      setVisible(message.visible === true);
      respond({ visible });
    }
  });
  void chrome.runtime.sendMessage({ type: "VU_METER_GET_VISIBILITY" }).then((response) => {
    if (!visibilityReceived) setVisible(response?.visible === true);
  }).catch(() => {});

  document.addEventListener("yt-navigate-finish", discover);
  window.addEventListener("pagehide", (event) => {
    releaseCapture();
    if (!event.persisted) {
      clearInterval(discoveryTimer);
      cancelAnimationFrame(frame);
      mediaEvents?.abort();
      void context?.close().catch(() => {});
    }
  });
})();
