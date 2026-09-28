// Real Chromium + real audio, no npm dependencies. Uses an isolated browser profile.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const extension = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'youtube-vu-test-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', join(temporary, 'key.pem'), '-out', join(temporary, 'cert.pem'),
  '-subj', '/CN=www.youtube.com', '-days', '1'], { stdio: 'ignore' });

function wav(channels = 2) {
  const rate = 48000;
  const samples = rate * 4;
  const data = Buffer.alloc(44 + samples * channels * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(channels, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * channels * 2, 28);
  data.writeUInt16LE(channels * 2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
  for (let i = 0; i < samples; i++) {
    for (let c = 0; c < channels; c++) {
      const amplitude = c === 0 ? 0.5 : 0.125;
      data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * amplitude * 32767),
        44 + (i * channels + c) * 2);
    }
  }
  return data;
}
const html = `<!doctype html><meta charset="utf-8"><title>Test YouTube Vu-mètre</title>
<style>body{margin:40px;background:#202630;color:white;font:16px system-ui}
#movie_player{position:relative;width:960px;height:540px;background:#080b10}
video{width:100%;height:100%}</style>
<h1>Test du signal audio · lecteur en sourdine</h1>
<div id="movie_player" class="html5-video-player"><video muted loop controls src="/stereo.wav"></video></div>`;
// Audio + video through MediaSource, including an open-ended stream like a live player.
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'color=c=0x102025:s=320x180:r=15', '-f', 'lavfi', '-i',
  'aevalsrc=0.5*sin(2*PI*440*t)|0.125*sin(2*PI*440*t):s=48000',
  '-t', '8', '-c:v', 'libvpx', '-deadline', 'realtime', '-c:a', 'libvorbis',
  '-f', 'webm', join(temporary, 'stream.webm')]);
const webm = readFileSync(join(temporary, 'stream.webm'));
const server = createServer({ key: readFileSync(join(temporary, 'key.pem')),
  cert: readFileSync(join(temporary, 'cert.pem')) }, (req, res) => {
  if (req.url === '/stream.webm') {
    res.writeHead(200, { 'Content-Type': 'video/webm' });
    res.end(webm);
    return;
  }
  const audio = req.url.endsWith('.wav');
  res.writeHead(200, { 'Content-Type': audio ? 'audio/wav' : 'text/html' });
  res.end(audio ? wav(req.url.includes('mono') ? 1 : 2) : html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
let stderr = '';
const browser = spawn(process.env.CHROMIUM || 'chromium', ['--headless=new', '--no-sandbox',
  '--disable-gpu', '--no-proxy-server', '--ignore-certificate-errors', '--mute-audio',
  '--disable-background-networking', '--remote-debugging-port=0',
  `--user-data-dir=${join(temporary, 'profile')}`, `--disable-extensions-except=${extension}`,
  `--load-extension=${extension}`, '--host-resolver-rules=MAP www.youtube.com 127.0.0.1', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
browser.stderr.on('data', (data) => { stderr += data; });
let socket;
try {
  for (let i = 0; i < 100 && !stderr.includes('DevTools listening on'); i++) await delay(100);
  const endpoint = stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
  assert(endpoint, `Chromium failed to start: ${stderr}`);
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'warning') {
      console.warn(...message.params.args.map((arg) => arg.description || arg.value));
    }
    else if (message.method === 'Media.playerErrorsRaised') console.warn(JSON.stringify(message.params));
    else if (message.method === 'Media.playerMessagesLogged') {
      for (const entry of message.params.messages) if (entry.level === 'error') console.warn(entry.message);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call('Runtime.enable');
  await call('Media.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expression) => {
    const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const until = async (expression, label) => {
    for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await delay(100); }
    throw new Error(`Timed out: ${label}\n${JSON.stringify(await snapshot())}`);
  };
  const snapshot = () => evaluate(`(() => {
    const root = document.querySelector('yt-audio-meter')?.shadowRoot;
    return { values: [...(root?.querySelectorAll('output') || [])].map(n => n.textContent),
      status: root?.querySelector('.status')?.textContent,
      muted: document.querySelector('video')?.muted,
      volume: document.querySelector('video')?.volume };
  })()`);
  const click = async (selector) => {
    const point = await evaluate(`(() => { const r = document.querySelector('yt-audio-meter').shadowRoot.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  };
  await call('Page.navigate', { url: `https://www.youtube.com:${port}/watch?v=fixture` });
  let worker;
  for (let i = 0; i < 80 && !worker; i++) {
    worker = (await send('Target.getTargets')).targetInfos.find((target) =>
      target.type === 'service_worker' && target.url.endsWith('/background.js'));
    if (!worker) await delay(100);
  }
  assert(worker, 'extension service worker started');
  const { sessionId: workerSession } = await send('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
  await send('Runtime.enable', {}, workerSession);
  const workerEvaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, workerSession);
    assert(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  await send('Target.activateTarget', { targetId });
  const tabId = await workerEvaluate(`chrome.tabs.query({active:true, lastFocusedWindow:true}).then(tabs => tabs[0].id)`);
  const waitForContent = async (id) => {
    for (let i = 0; i < 80; i++) {
      if (await workerEvaluate(`chrome.tabs.sendMessage(${id}, {type:'VU_METER_PING'}).then(() => true, () => false)`)) return;
      await delay(100);
    }
    throw new Error('Content script did not become ready');
  };
  await waitForContent(tabId);
  await delay(1100);
  assert.equal(await evaluate(`document.querySelector('yt-audio-meter') === null`), true);
  // Headless Chrome has no physical toolbar. Invoke its registered click handler
  // inside the actual worker; storage, tab messages and content scripts are real.
  assert.equal(await workerEvaluate(`chrome.action.onClicked.hasListener(handleAction)`), true);
  const toolbarClick = () => workerEvaluate(`handleAction({id:${tabId}})`);
  await toolbarClick();
  await until(`document.querySelector('yt-audio-meter')?.shadowRoot`, 'toolbar shows the meter');
  assert.equal(await workerEvaluate(`chrome.action.getBadgeText({tabId:${tabId}})`), 'ON');
  console.log('PASS: hidden by default; toolbar handler shows the meter and ON badge');
  await evaluate(`document.querySelector('video').play()`);
  await click('footer > button:last-child');
  await until(`Math.abs(parseFloat(document.querySelector('yt-audio-meter').shadowRoot.querySelector('output').textContent) + 9.03) < 0.5`, 'muted audio measured');
  const muted = await snapshot();
  assert.equal(muted.muted, true);
  assert(Math.abs(Number(muted.values[0]) + 9.03) < 1, JSON.stringify(muted));
  assert(Math.abs(Number(muted.values[1]) + 21.07) < 1, JSON.stringify(muted));
  console.log('PASS: extension injection; muted stereo signal with calibrated RMS levels', muted);

  await evaluate(`document.querySelector('video').muted = false; document.querySelector('video').volume = 0`);
  await delay(400);
  const zero = await snapshot();
  assert.equal(zero.volume, 0);
  assert(Math.abs(Number(zero.values[0]) + 9.03) < 1);
  console.log('PASS: zero player volume still measured');
  await evaluate(`document.querySelector('video').volume = 0.2`);
  await delay(300);
  assert(Math.abs(Number((await snapshot()).values[0]) + 9.03) < 1);
  console.log('PASS: low player volume does not change source measurement');

  await evaluate(`document.querySelector('video').pause()`);
  await until(`document.querySelector('yt-audio-meter').shadowRoot.querySelector('.status').textContent === 'En pause'`, 'pause status');
  assert.deepEqual((await snapshot()).values, ['−∞', '−∞']);
  await evaluate(`document.querySelector('video').src='/mono.wav'; document.querySelector('video').play()`);
  await until(`Math.abs(parseFloat(document.querySelector('yt-audio-meter').shadowRoot.querySelectorAll('output')[1].textContent) + 9.03) < 1`, 'mono source replacement');
  console.log('PASS: pause and source replacement; mono on both channels');

  await evaluate(`(() => { const previous = document.querySelector('video'); const next = document.createElement('video'); next.src='/stereo.wav'; next.muted=true; next.loop=true; previous.replaceWith(next); return next.play(); })()`);
  await until(`Math.abs(parseFloat(document.querySelector('yt-audio-meter').shadowRoot.querySelectorAll('output')[1].textContent) + 21.07) < 1`, 'player replacement');
  console.log('PASS: new player detected after navigation');
  await click('footer > button:last-child');
  await until(`document.querySelector('yt-audio-meter').shadowRoot.querySelector('footer > button:last-child').textContent === 'Activer'`, 'stop');
  assert.deepEqual((await snapshot()).values, ['−∞', '−∞']);
  assert.equal((await snapshot()).muted, true);
  await click('footer > button:last-child');
  await until(`Number.isFinite(parseFloat(document.querySelector('yt-audio-meter').shadowRoot.querySelector('output').textContent))`, 'restart');
  console.log('PASS: stop/restart leaves player muted');

  await evaluate(`(async () => {
    const video = document.querySelector('video');
    const media = new MediaSource();
    window.testMediaSource = media;
    video.loop = false;
    video.src = URL.createObjectURL(media);
    await new Promise(resolve => media.addEventListener('sourceopen', resolve, {once:true}));
    const buffer = media.addSourceBuffer('video/webm; codecs="vp8,vorbis"');
    window.testSourceBuffer = buffer;
    window.testWebm = await (await fetch('/stream.webm')).arrayBuffer();
    const updated = new Promise(resolve => buffer.addEventListener('updateend', resolve, {once:true}));
    buffer.appendBuffer(window.testWebm);
    await updated;
    if (media.readyState !== 'open') {
      await new Promise(resolve => setTimeout(resolve, 500));
      throw new Error(JSON.stringify({state:media.readyState, videoError:video.error?.message}));
    }
    media.duration = Infinity;
    await video.play();
  })()`);
  await until(`Math.abs(parseFloat(document.querySelector('yt-audio-meter').shadowRoot.querySelector('output').textContent) + 9.03) < 1`, 'MediaSource live audio');
  assert.equal(await evaluate(`document.querySelector('video').duration === Infinity`), true);
  const before = await evaluate(`document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames`);
  await delay(600);
  const after = await evaluate(`document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames`);
  assert(after > before, 'stopping the captured video track must not stop the original video');
  assert.equal((await snapshot()).muted, true);
  console.log('PASS: open-ended MediaSource stream measured while muted; original video still renders');
  await evaluate(`(async () => {
    const buffer = window.testSourceBuffer;
    buffer.timestampOffset = 8;
    const updated = new Promise(resolve => buffer.addEventListener('updateend', resolve, {once:true}));
    buffer.appendBuffer(window.testWebm);
    await updated;
    document.querySelector('video').currentTime = 9;
  })()`);
  await until(`document.querySelector('video').currentTime > 9.1 && Math.abs(parseFloat(document.querySelector('yt-audio-meter').shadowRoot.querySelector('output').textContent) + 9.03) < 1`, 'appended live segment');
  console.log('PASS: measurement continues into a newly appended live segment');

  await click('header > button:last-child');
  assert.equal(await evaluate(`document.querySelector('yt-audio-meter').hasAttribute('compact')`), true);
  await click('header > button:last-child');
  await click('.position');
  assert.equal(await evaluate(`document.querySelector('yt-audio-meter').hasAttribute('left')`), true);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('PASS: compact mode and position controls; no uncaught browser errors');
  if (process.env.SCREENSHOT) {
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolve(process.env.SCREENSHOT), Buffer.from(data, 'base64'));
  }

  // Hide while actively measuring: no floating pill, no effect on playback/mute.
  await toolbarClick();
  await until(`document.querySelector('yt-audio-meter') === null`, 'toolbar hides the entire meter');
  assert.equal(await workerEvaluate(`chrome.action.getBadgeText({tabId:${tabId}})`), '');
  assert.equal(await evaluate(`document.querySelector('video').muted && !document.querySelector('video').paused`), true);
  await evaluate(`document.dispatchEvent(new Event('yt-navigate-finish'))`);
  await delay(1100);
  assert.equal(await evaluate(`document.querySelector('yt-audio-meter') === null`), true);
  await toolbarClick();
  await until(`document.querySelector('yt-audio-meter')?.shadowRoot.querySelector('footer > button:last-child').textContent === 'Activer'`, 'show again with analysis stopped');
  await click('footer > button:last-child');
  await until(`Math.abs(parseFloat(document.querySelector('yt-audio-meter').shadowRoot.querySelector('output').textContent) + 9.03) < 1`, 'muted audio after hiding and showing');
  console.log('PASS: hiding removes the entire panel; playback unaffected; muted analysis can restart');

  await call('Page.reload');
  await waitForContent(tabId);
  await until(`document.querySelector('yt-audio-meter')?.shadowRoot`, 'visible state survives reload');
  await toolbarClick();
  await until(`document.querySelector('yt-audio-meter') === null`, 'hidden before reload');
  await call('Page.reload');
  await waitForContent(tabId);
  await delay(1100);
  assert.equal(await evaluate(`document.querySelector('yt-audio-meter') === null`), true);
  await workerEvaluate(`Promise.all([handleAction({id:${tabId}}), handleAction({id:${tabId}})])`);
  assert.equal(await evaluate(`document.querySelector('yt-audio-meter') === null`), true);
  console.log('PASS: visible/hidden state survives reload; rapid double click returns to hidden');

  await toolbarClick();
  const secondTabId = await workerEvaluate(`chrome.tabs.create({url:${JSON.stringify(`https://www.youtube.com:${port}/watch?v=second`)}, active:false}).then(tab => tab.id)`);
  await waitForContent(secondTabId);
  assert.equal(await workerEvaluate(`isVisible(${secondTabId})`), false);
  assert.equal(await workerEvaluate(`chrome.action.getBadgeText({tabId:${secondTabId}})`), '');
  assert.equal(await workerEvaluate(`isVisible(${tabId})`), true);
  await workerEvaluate(`handleAction({id:${secondTabId}})`);
  assert.equal(await workerEvaluate(`isVisible(${secondTabId})`), true);
  await workerEvaluate(`chrome.tabs.remove(${secondTabId})`);
  for (let i = 0; i < 80 && await workerEvaluate(`isVisible(${secondTabId})`); i++) await delay(100);
  assert.equal(await workerEvaluate(`isVisible(${secondTabId})`), false);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('PASS: new tabs stay hidden independently; closing a tab clears its state; no browser errors');
} finally {
  socket?.close();
  browser.kill('SIGTERM');
  await new Promise((resolve) => { if (browser.exitCode !== null) resolve(); else browser.once('exit', resolve); });
  await new Promise((resolve) => server.close(resolve));
  rmSync(temporary, { recursive: true, force: true });
}
