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

/* ---- what YouTube itself knows about this video ----
   "Music in this video" (songs YouTube identified by listening), chapters, description,
   and comments that contain a timestamped tracklist. Sent to the app as soon as available. */
const txt = v => !v ? '' : typeof v === 'string' ? v : (v.simpleText || v.content || (v.runs ? v.runs.map(r => r.text).join('') : ''));
function jsonVar(name) {
  for (const s of document.querySelectorAll('script')) {
    const t = s.textContent, i = t.indexOf(name + ' = ');
    if (i < 0) continue;
    const a = t.indexOf('{', i);
    let depth = 0, inStr = false, esc = false;
    for (let k = a; k < t.length; k++) {
      const c = t[k];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) { try { return JSON.parse(t.slice(a, k + 1)); } catch (e) { return null; } }
    }
  }
  return null;
}
function walkObj(o, fn) { const st = [o]; let n = 0; while (st.length && n++ < 400000) { const x = st.pop(); if (x && typeof x === 'object') { fn(x); for (const k in x) st.push(x[k]); } } }
function ytInfo() {
  const d = jsonVar('ytInitialData'), pr = jsonVar('ytInitialPlayerResponse');
  const music = [], chapters = []; let desc = '', title = '';
  if (d) walkObj(d, x => {
    if (x.chapterRenderer) chapters.push({ t: (x.chapterRenderer.timeRangeStartMillis || 0) / 1000, title: txt(x.chapterRenderer.title) });
    if (x.macroMarkersListItemRenderer) { const m = x.macroMarkersListItemRenderer, tm = txt(m.timeDescription); const p = tm.split(':').map(Number);
      if (p.length > 1 && p.every(n => !isNaN(n))) chapters.push({ t: p.reduce((a, b) => a * 60 + b, 0), title: txt(m.title) }); }
    if (x.videoAttributeViewModel) { const v = x.videoAttributeViewModel; const t1 = txt(v.title); if (t1) music.push({ title: t1, artist: txt(v.subtitle) }); }
    if (x.carouselLockupRenderer) { let song = '', artist = '';
      for (const r of (x.carouselLockupRenderer.infoRows || [])) { const ir = r.infoRowRenderer; if (!ir) continue;
        const k = txt(ir.title).toLowerCase(), v = txt(ir.defaultMetadata) || txt(ir.expandedMetadata);
        if (/song|أغنية|اغنية|الأغنية/.test(k)) song = v; if (/artist|فنان|الفنان/.test(k)) artist = v; }
      if (song) music.push({ title: song, artist }); }
    if (!desc && x.attributedDescription) desc = txt(x.attributedDescription);
    if (!title && x.videoPrimaryInfoRenderer) title = txt(x.videoPrimaryInfoRenderer.title);
  });
  if (pr && pr.videoDetails) { if (!desc) desc = pr.videoDetails.shortDescription || ''; if (!title) title = pr.videoDetails.title || ''; }
  const seen = new Set(), uniq = arr => arr.filter(m => { const k = JSON.stringify(m).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  const comments = [...document.querySelectorAll('ytd-comment-thread-renderer #content-text')].map(e => e.innerText)
    .filter(t => (t.match(/\d{1,2}:\d{2}/g) || []).length >= 3).slice(0, 5);
  return { title, music: uniq(music), chapters: uniq(chapters), desc, comments };
}
let lastInfo = '';
function sendInfo() { try { const i = ytInfo(), s = JSON.stringify(i); if (s !== lastInfo) { lastInfo = s; ipcRenderer.send('yt-info', i); } } catch (e) {} }
window.addEventListener('DOMContentLoaded', () => setTimeout(sendInfo, 1500));
setInterval(sendInfo, 5000);

/* ---- song bar: on Shazam (or any site showing a song), offer Spotify / Anghami / … and "add to my track list" ---- */
function songOnPage() {
  const host = location.hostname;
  if (/shazam\.com$/.test(host) && /\/(song|track)\//.test(location.pathname)) {
    const og = (document.querySelector('meta[property="og:title"]') || {}).content || document.title || '';
    const t = og.split(/[:|]/)[0].trim(); const m = t.split(/\s+[-–—]\s+/);
    const apple = [...document.querySelectorAll('a[href*="music.apple.com"]')].map(a => a.href)[0] || '';
    const spotify = [...document.querySelectorAll('a[href*="open.spotify.com"]')].map(a => a.href)[0] || '';
    if (m.length > 1) return { title: m[0].trim(), artist: m.slice(1).join(' - ').trim(), apple, spotify };
    if (t) return { title: t, artist: '', apple, spotify };
  }
  return null;
}
const APPS_BAR = [
  ['Spotify', '#1DB954', (q, s) => s.spotify || 'https://open.spotify.com/search/' + q], ['أنغامي', '#A13CFF', q => 'https://play.anghami.com/search/' + q],
  ['YouTube', '#FF0000', q => 'https://www.youtube.com/results?search_query=' + q], ['Apple Music', '#FA243C', (q, s) => s.apple || 'https://music.apple.com/search?term=' + q],
  ['Deezer', '#A238FF', q => 'https://www.deezer.com/search/' + q], ['SoundCloud', '#FF5500', q => 'https://soundcloud.com/search?q=' + q], ['Beatport', '#01FF95', q => 'https://www.beatport.com/search?q=' + q]];
let barKey = '';
function songBar() {
  const s = songOnPage(), key = s ? s.artist + '|' + s.title : '';
  let bar = document.getElementById('__ia_bar');
  if (!s) { if (bar) bar.remove(); barKey = ''; return; }
  if (key === barKey && bar) return; barKey = key;
  if (!bar) { bar = document.createElement('div'); bar.id = '__ia_bar'; document.documentElement.appendChild(bar); }
  bar.setAttribute('style', 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 14px;' +
    'background:rgba(12,10,14,.96);border-top:2px solid #c94a6a;box-shadow:0 -8px 24px rgba(0,0,0,.5);font:600 13px "Segoe UI",Tahoma,sans-serif;color:#f4eef1;direction:rtl');
  const q = encodeURIComponent((s.artist ? s.artist + ' ' : '') + s.title);
  bar.innerHTML = '';
  const label = document.createElement('span'); label.textContent = (s.artist ? s.artist + ' - ' : '') + s.title; label.style.cssText = 'margin-inline-end:8px;direction:ltr';
  bar.appendChild(label);
  for (const [n, c, u] of APPS_BAR) { const a = document.createElement('a'); a.href = u(q, s); a.target = '_blank'; a.textContent = 'افتح في ' + n;
    a.style.cssText = `color:#fff;text-decoration:none;padding:6px 11px;border-radius:999px;border:1px solid ${c};background:${c}33`; bar.appendChild(a); }
  const add = document.createElement('button'); add.textContent = '+ ضيفه لقايمة التراكات في البرنامج';
  add.style.cssText = 'margin-inline-start:auto;color:#fff;border:1px solid #a3203f;background:linear-gradient(180deg,#a3203f,#7a1530);padding:7px 13px;border-radius:10px;cursor:pointer;font:inherit';
  add.onclick = () => { ipcRenderer.send('web-track', { title: s.title, artist: s.artist, apple: s.apple, spotify: s.spotify }); add.textContent = '✓ اتضاف'; };
  bar.appendChild(add);
}
setInterval(songBar, 1200);
