// Runs inside the YouTube window: listens to the playing video and sends the sound (11025 Hz mono) to the app.
// Nothing is downloaded or saved; it only listens while the video plays, like Shazam.
const { ipcRenderer } = require('electron');
const OUT = 11025;
let ctx = null, cur = null;

function attach(v) {
  if (cur && cur.v === v && cur.alive()) return;
  if (cur) cur.stop();
  let stream;
  try { stream = v.captureStream ? v.captureStream() : null; } catch (e) { stream = null; }
  if (!stream || !stream.getAudioTracks().length) return;
  ctx = ctx || new AudioContext();
  const src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const sp = ctx.createScriptProcessor(4096, 1, 1), mute = ctx.createGain(); mute.gain.value = 0;
  const ratio = ctx.sampleRate / OUT; let pos = 0, carry = new Float32Array(0);
  sp.onaudioprocess = (e) => {
    if (v.paused || v.seeking) return;
    const inp = e.inputBuffer.getChannelData(0);
    const x = new Float32Array(carry.length + inp.length); x.set(carry); x.set(inp, carry.length);
    const w = Math.max(1, Math.round(ratio)), out = [];
    while (pos + w < x.length) { let s = 0; const i = Math.floor(pos); for (let k = 0; k < w; k++) s += x[i + k]; out.push(s / w); pos += ratio; }
    const used = Math.floor(pos); carry = x.slice(used); pos -= used;
    if (out.length) ipcRenderer.send('yt-audio', { samples: Float32Array.from(out), time: v.currentTime });
  };
  src.connect(sp); sp.connect(mute); mute.connect(ctx.destination);
  const tracks = stream.getAudioTracks();
  cur = { v, alive: () => tracks.some(t => t.readyState === 'live'), stop() { try { sp.disconnect(); src.disconnect(); } catch (e) {} } };
}
function onVideo(v) {
  if (v.__dj) return; v.__dj = true;
  v.addEventListener('playing', () => { if (ctx) ctx.resume(); attach(v); });
  v.addEventListener('seeking', () => ipcRenderer.send('yt-audio', { reset: true }));
  v.addEventListener('loadedmetadata', () => { ipcRenderer.send('yt-audio', { reset: true }); if (!v.paused) attach(v); });
  if (!v.paused) attach(v);
}
setInterval(() => { document.querySelectorAll('video').forEach(onVideo); }, 1000);
