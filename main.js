// Islam Ayman Studio — desktop app (Windows / Mac)
const { app, BrowserWindow, ipcMain, shell, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null, yt = null;
const YT_RE = /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i;

/* ---------- permanent data folder ----------
   Documents/Islam Ayman Studio  — NOT inside the install folder, so uninstalling,
   reinstalling or installing a new version never deletes it. */
const DATA = () => path.join(app.getPath('documents'), 'Islam Ayman Studio');
// the program used to be called "Islam Ayman Edits": move that folder over once, so nothing is lost
function migrateOldData() {
  const old = path.join(app.getPath('documents'), 'Islam Ayman Edits');
  try {
    if (fs.existsSync(old) && !fs.existsSync(DATA())) {
      try { fs.renameSync(old, DATA()); } catch (e) { fs.cpSync(old, DATA(), { recursive: true }); }
    }
  } catch (e) {}
}
const LIB = () => path.join(DATA(), 'library');
const STORES = new Set(['settings', 'franco', 'history', 'sets', 'styles']);
function ensure() { fs.mkdirSync(LIB(), { recursive: true }); }
function writeAtomic(file, data) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); }
function readJson(file, def) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return def; } }

// every saved file keeps a backup copy (.bak); if the main file is ever damaged, the backup is used
ipcMain.handle('store-get', (e, name) => { if (!STORES.has(name)) return null;
  const f = path.join(DATA(), name + '.json'); return readJson(f, null) ?? readJson(f + '.bak', null); });
ipcMain.handle('store-set', (e, name, value) => {
  if (!STORES.has(name)) return false; ensure();
  const f = path.join(DATA(), name + '.json'), txt = JSON.stringify(value, null, 1);
  writeAtomic(f, txt); try { JSON.parse(fs.readFileSync(f, 'utf8')); writeAtomic(f + '.bak', txt); } catch (err) {} return true;
});
ipcMain.handle('data-dir', () => { ensure(); return DATA(); });
ipcMain.handle('open-data-dir', () => { ensure(); return shell.openPath(DATA()); });

// fingerprint library: library/index.json + one small .bin per song
ipcMain.handle('lib-load', () => {
  const idx = readJson(path.join(LIB(), 'index.json'), []), out = [];
  for (const m of idx) {
    try {
      const b = fs.readFileSync(path.join(LIB(), m.id + '.bin'));
      const u = new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
      out.push({ ...m, hashes: u.slice(0, m.n), times: u.slice(m.n, 2 * m.n) });
    } catch (e) {}
  }
  return out;
});
ipcMain.handle('lib-add', (e, recs) => {
  ensure(); const file = path.join(LIB(), 'index.json'), idx = readJson(file, []), have = new Set(idx.map(m => m.key));
  for (const r of recs) {
    if (have.has(r.key)) continue;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8), n = r.hashes.length;
    const u = new Uint32Array(2 * n); u.set(r.hashes, 0); u.set(r.times, n);
    fs.writeFileSync(path.join(LIB(), id + '.bin'), Buffer.from(u.buffer));
    idx.push({ id, key: r.key, file: r.file, title: r.title, artist: r.artist, n }); have.add(r.key);
  }
  writeAtomic(file, JSON.stringify(idx)); return idx.length;
});
ipcMain.handle('lib-clear', () => { try { fs.rmSync(LIB(), { recursive: true, force: true }); } catch (e) {} ensure(); return true; });

/* ---------- files: always ask where to save (Windows "Save as" dialog) ---------- */
const AUDIO_RE = /\.(mp3|m4a|wav|flac|aac|ogg|aif|aiff)$/i;
const allowedDirs = new Set();          // folders the user picked in this run (we only write there)
function lastDir() { const s = readJson(path.join(DATA(), 'paths.json'), {}); return s.lastDir && fs.existsSync(s.lastDir) ? s.lastDir : app.getPath('music'); }
function rememberDir(d) { try { ensure(); writeAtomic(path.join(DATA(), 'paths.json'), JSON.stringify({ lastDir: d })); } catch (e) {} }
ipcMain.handle('save-file', async (e, name, data) => {
  const ext = (path.extname(name).slice(1) || 'mp3').toLowerCase();
  const r = await dialog.showSaveDialog(win, { title: 'تحفظ الملف فين؟', defaultPath: path.join(lastDir(), name),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'All files', extensions: ['*'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(data)); rememberDir(path.dirname(r.filePath));
  return r.filePath;
});
ipcMain.handle('pick-folder', async (e, title) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'اختار فولدر', defaultPath: lastDir(), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  allowedDirs.add(r.filePaths[0]); rememberDir(r.filePaths[0]); return r.filePaths[0];
});
ipcMain.handle('list-audio', (e, dir) => {
  if (!allowedDirs.has(dir)) return [];
  const out = [];
  (function walk(d, rel) {
    let items = []; try { items = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const it of items) {
      if (it.name.startsWith('.')) continue;
      const p = path.join(d, it.name);
      if (it.isDirectory()) { if (it.name !== 'DJ ISLAM AYMAN') walk(p, rel + it.name + '/'); }
      else if (AUDIO_RE.test(it.name)) { try { const st = fs.statSync(p); out.push({ path: p, rel: rel + it.name, name: it.name, size: st.size, mtime: st.mtimeMs }); } catch (e) {} }
    }
  })(dir, '');
  return out;
});
ipcMain.handle('read-file', (e, p) => {
  if (!AUDIO_RE.test(p) || ![...allowedDirs].some(d => path.resolve(p).startsWith(path.resolve(d) + path.sep))) throw new Error('not allowed');
  return fs.readFileSync(p);
});
ipcMain.handle('write-file', (e, dir, name, data) => {
  if (!allowedDirs.has(dir)) throw new Error('not allowed');
  name = path.basename(name).replace(/[\\/:*?"<>|]+/g, ' ');
  let p = path.join(dir, name), n = 2; const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${n++})${ext}`);
  fs.writeFileSync(p, Buffer.from(data)); return p;
});
ipcMain.handle('show-in-folder', (e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); });

/* ---------- song recognition (ACRCloud / AudD), called from the app itself, not a web page ---------- */
const crypto = require('crypto');
ipcMain.handle('recognize', async (e, prov, cfg, data, name) => {
  const buf = Buffer.from(data);
  if (prov === 'acr') {
    const host = String(cfg.host || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
    if (!/^[a-z0-9.-]+\.acrcloud\.com$/i.test(host)) throw new Error('ACRCloud host مش مظبوط (لازم ينتهي بـ acrcloud.com)');
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = crypto.createHmac('sha1', String(cfg.secret)).update(['POST', '/v1/identify', cfg.key, 'audio', '1', ts].join('\n')).digest('base64');
    const fd = new FormData();
    fd.append('sample', new Blob([buf]), name); fd.append('sample_bytes', String(buf.length)); fd.append('access_key', cfg.key);
    fd.append('data_type', 'audio'); fd.append('signature_version', '1'); fd.append('signature', sig); fd.append('timestamp', ts);
    const r = await fetch(`https://${host}/v1/identify`, { method: 'POST', body: fd }); return await r.json();
  }
  const fd = new FormData();
  fd.append('file', new Blob([buf]), name); fd.append('return', 'spotify,apple_music,deezer'); fd.append('api_token', cfg.token);
  const r = await fetch('https://api.audd.io/', { method: 'POST', body: fd }); return await r.json();
});

/* ---------- Spotify: make a playlist in the user's own account (official Web API, PKCE login) ---------- */
const http = require('http');
const SP_PORT = 43821, SP_REDIRECT = `http://127.0.0.1:${SP_PORT}/callback`;
const SP_FILE = () => path.join(DATA(), 'spotify.json');
const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function spSave(t) { ensure(); writeAtomic(SP_FILE(), JSON.stringify(t)); }
async function spToken(clientId) {
  const t = readJson(SP_FILE(), null);
  if (!t || t.clientId !== clientId) return null;
  if (Date.now() < t.expires - 60000) return t.access;
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: clientId }) });
  const j = await r.json(); if (!j.access_token) return null;
  spSave({ ...t, access: j.access_token, refresh: j.refresh_token || t.refresh, expires: Date.now() + j.expires_in * 1000 }); return j.access_token;
}
ipcMain.handle('spotify-status', async (e, clientId) => !!(await spToken(clientId).catch(() => null)));
ipcMain.handle('spotify-login', (e, clientId) => new Promise((resolve, reject) => {
  const verifier = b64url(crypto.randomBytes(48)), challenge = b64url(crypto.createHash('sha256').update(verifier).digest()), state = b64url(crypto.randomBytes(12));
  let done = false;
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, SP_REDIRECT); if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
    const page = (ok, txt) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html dir="rtl"><body style="background:#0b0a0e;color:#f4eef1;font:20px Tahoma;display:grid;place-items:center;height:90vh"><div>${ok ? '✓' : '✗'} ${txt}</div></body></html>`); };
    try {
      if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) throw new Error(u.searchParams.get('error') || 'login cancelled');
      const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: u.searchParams.get('code'), redirect_uri: SP_REDIRECT, client_id: clientId, code_verifier: verifier }) });
      const j = await r.json(); if (!j.access_token) throw new Error(j.error_description || j.error || 'no token');
      spSave({ clientId, access: j.access_token, refresh: j.refresh_token, expires: Date.now() + j.expires_in * 1000 });
      page(true, 'تمام، اتربط حساب سبوتيفاي. ارجع لبرنامج Islam Ayman Studio.'); done = true; srv.close(); if (win) win.focus(); resolve(true);
    } catch (err) { page(false, 'الربط ما نجحش: ' + err.message); done = true; srv.close(); reject(err); }
  });
  srv.on('error', reject);
  srv.listen(SP_PORT, '127.0.0.1', () => {
    const q = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: SP_REDIRECT, code_challenge_method: 'S256', code_challenge: challenge, state,
      scope: 'playlist-modify-private playlist-modify-public' });
    shell.openExternal('https://accounts.spotify.com/authorize?' + q);
  });
  setTimeout(() => { if (!done) { srv.close(); reject(new Error('timeout')); } }, 5 * 60 * 1000);
}));
ipcMain.handle('spotify-playlist', async (e, clientId, name, tracks) => {
  const tok = await spToken(clientId); if (!tok) throw new Error('login');
  const api = async (p, opt = {}) => { const r = await fetch('https://api.spotify.com/v1' + p, { ...opt, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error((j.error && j.error.message) || ('Spotify ' + r.status)); return j; };
  const norm = x => String(x || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/feat\.?.*$|ft\.?.*$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // check first that Spotify lets this account use the app (clear message instead of "not found")
  try { await api('/me'); } catch (err) { throw new Error('SPOTIFY_REFUSED: ' + err.message); }
  const uris = [], missing = [], seen = new Set(); let lastErr = null;
  for (const t of tracks) {
    let id = (String(t.spotify || '').match(/track\/([A-Za-z0-9]+)/) || [])[1];
    if (!id) for (const q of [`track:"${t.title}"${t.artist ? ` artist:"${t.artist.split(/,|&| x /i)[0].trim()}"` : ''}`, `${t.title} ${t.artist || ''}`.trim()]) {
      const j = await api('/search?type=track&limit=5&q=' + encodeURIComponent(q)).catch(err => { lastErr = err; return null; });
      const items = (j && j.tracks && j.tracks.items) || [];
      const hit = items.find(it => norm(it.name).includes(norm(t.title)) || norm(t.title).includes(norm(it.name))) || (q.startsWith('track:') ? items[0] : null);
      if (hit) { id = hit.id; break; }
    }
    if (id && !seen.has(id)) { seen.add(id); uris.push('spotify:track:' + id); } else if (!id) missing.push(t);
  }
  if (!uris.length && lastErr) throw new Error('SPOTIFY_REFUSED: ' + lastErr.message);
  if (!uris.length) return { url: '', added: 0, missing };
  const pl = await api('/me/playlists', { method: 'POST', body: JSON.stringify({ name, public: false, description: 'Made with Islam Ayman Studio · DJ ISLAM AYMAN' }) });
  for (let i = 0; i < uris.length; i += 100) await api(`/playlists/${pl.id}/tracks`, { method: 'POST', body: JSON.stringify({ uris: uris.slice(i, i + 100) }) });
  return { url: pl.external_urls && pl.external_urls.spotify, added: uris.length, missing };
});

/* ---------- New releases & trends: read-only calls to the official Spotify / YouTube APIs ---------- */
// app-only token (Client ID + Client Secret): reading public catalog data doesn't need the user's account
let spApp = { key: '', tok: '', exp: 0 };
async function spAppToken(clientId, secret) {
  if (!clientId || !secret) return null;
  if (spApp.key === clientId + secret && Date.now() < spApp.exp - 60000) return spApp.tok;
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64') },
    body: new URLSearchParams({ grant_type: 'client_credentials' }) });
  const j = await r.json().catch(() => ({})); if (!j.access_token) throw new Error('SPOTIFY_REFUSED: Client Secret: ' + (j.error_description || j.error || r.status));
  spApp = { key: clientId + secret, tok: j.access_token, exp: Date.now() + j.expires_in * 1000 }; return spApp.tok;
}
ipcMain.handle('spotify-get', async (e, clientId, p, secret) => {
  if (typeof p !== 'string' || !/^\/(search|browse\/new-releases)\?/.test(p)) throw new Error('not allowed');
  const call = async tok => { const r = await fetch('https://api.spotify.com/v1' + p, { headers: { Authorization: 'Bearer ' + tok } }); return { r, j: await r.json().catch(() => ({})) }; };
  let tok = await spToken(clientId).catch(() => null), res = tok ? await call(tok) : null;
  if ((!res || !res.r.ok) && secret) { const at = await spAppToken(clientId, secret); if (at) res = await call(at); }   // fall back to the app-only token
  if (!res) throw new Error('login');
  if (!res.r.ok) throw new Error('SPOTIFY_REFUSED: ' + ((res.j.error && res.j.error.message) || res.r.status)); return res.j;
});
ipcMain.handle('yt-api', async (e, p, key) => {
  if (typeof p !== 'string' || !/^\/(search|videos)\?/.test(p)) throw new Error('not allowed');
  const r = await fetch('https://www.googleapis.com/youtube/v3' + p + '&key=' + encodeURIComponent(key || ''));
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error((j.error && j.error.message) || ('YouTube ' + r.status)); return j;
});

/* ---------- AI: remove vocals from a part, keep the music ---------- */
const MODELS = () => app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(__dirname, 'models');
ipcMain.handle('separate-full', async (e, L, R) => {
  const { separateLong } = require('./separate.js');
  return separateLong(MODELS(), Float32Array.from(L), Float32Array.from(R));
});
// open a music-production app (Ableton, FL Studio, Logic …) and the folder with the exported parts
const { spawn } = require('child_process');
function findIn(dir, re, depth = 2) {
  try { for (const it of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, it.name);
    if (re.test(it.name)) return p; if (depth > 0 && it.isDirectory()) { const f = findIn(p, re, depth - 1); if (f) return f; } } } catch (e) {}
  return null;
}
function findDaw(id) {
  const W = process.platform === 'win32', PF = process.env['ProgramFiles'] || 'C:\\Program Files', PD = process.env['ProgramData'] || 'C:\\ProgramData';
  const mac = { ableton: /^Ableton Live.*\.app$/i, fl: /^FL Studio.*\.app$/i, logic: /^Logic Pro.*\.app$/i, cubase: /^Cubase.*\.app$/i, studioone: /^Studio One.*\.app$/i, garageband: /^GarageBand\.app$/i, bitwig: /^Bitwig Studio\.app$/i };
  if (!W) return mac[id] ? findIn('/Applications', mac[id], 0) : null;
  const win = { ableton: [path.join(PD, 'Ableton'), /^Ableton Live.*\.exe$/i, 3], fl: [path.join(PF, 'Image-Line'), /^FL64\.exe$/i, 2],
    cubase: [path.join(PF, 'Steinberg'), /^Cubase\d*\.exe$/i, 2], studioone: [path.join(PF, 'PreSonus'), /^Studio One\.exe$/i, 2], bitwig: [path.join(PF, 'Bitwig Studio'), /^Bitwig Studio\.exe$/i, 1] };
  const w = win[id]; return w ? findIn(w[0], w[1], w[2]) : null;
}
ipcMain.handle('open-daw', (e, id, folder) => {
  const p = findDaw(id); if (!p) return false;
  if (process.platform === 'darwin') spawn('open', ['-a', p], { detached: true, stdio: 'ignore' }).unref();
  else spawn(p, [], { detached: true, stdio: 'ignore' }).unref();
  if (folder && fs.existsSync(folder)) shell.openPath(folder);
  return true;
});
ipcMain.handle('open-folder', (e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.openPath(p); });
ipcMain.handle('separate', async (e, L, R) => {
  const { separate } = require('./separate.js');
  const r = await separate(MODELS(), Float32Array.from(L), Float32Array.from(R));
  return { L: r.music[0], R: r.music[1] };
});

/* ---------- windows ---------- */
function createMain() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    backgroundColor: '#09080b', title: 'Islam Ayman Studio', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; if (yt) yt.close(); });
}
// YouTube plays in its own window; its audio is streamed to the main window for track ID
// Web windows (YouTube, Shazam, SoundCloud…) look exactly like Google Chrome to the sites,
// otherwise some sites (Shazam) refuse to open ("405 Not Allowed").
let webSession = null;
function chromeUA() {
  const os = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`;
}
function getWebSession() {
  if (webSession) return webSession;
  webSession = session.fromPartition('persist:web');
  webSession.setUserAgent(chromeUA(), 'en-US,en;q=0.9,ar;q=0.8');
  const major = process.versions.chrome.split('.')[0];
  const plat = process.platform === 'darwin' ? '"macOS"' : process.platform === 'win32' ? '"Windows"' : '"Linux"';
  webSession.webRequest.onBeforeSendHeaders((d, cb) => {
    const h = d.requestHeaders;
    for (const k of Object.keys(h)) {
      const l = k.toLowerCase();
      if (l === 'sec-ch-ua') h[k] = `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not?A_Brand";v="99"`;
      else if (l === 'sec-ch-ua-platform') h[k] = plat;
      else if (l === 'user-agent') h[k] = chromeUA();
    }
    cb({ requestHeaders: h });
  });
  return webSession;
}
function openYouTube(url) {
  if (yt) { yt.loadURL(url); yt.focus(); return; }
  yt = new BrowserWindow({
    width: 1100, height: 760, title: 'Islam Ayman Studio', autoHideMenuBar: true, backgroundColor: '#000',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { session: getWebSession(), preload: path.join(__dirname, 'yt-preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  yt.webContents.setUserAgent(chromeUA());
  // if a site refuses to open (an error page), tell the main window so it can offer the normal browser
  yt.webContents.on('did-navigate', (e, u, code) => { if (code >= 400 && win) win.webContents.send('web-error', { url: u, code }); });
  yt.webContents.on('did-fail-load', (e, code, desc, u, isMain) => { if (isMain && code !== -3 && win) win.webContents.send('web-error', { url: u, code: desc }); });
  yt.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  yt.on('closed', () => { yt = null; if (win) win.webContents.send('yt-closed'); });
  yt.loadURL(url);
}
ipcMain.on('yt-open', (e, url) => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) openYouTube(url); });   // YouTube, Shazam, SoundCloud, any site
ipcMain.on('yt-close', () => { if (yt) yt.close(); });
ipcMain.on('open-external', (e, url) => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url); });
ipcMain.on('yt-audio', (e, d) => { if (win && yt && e.sender === yt.webContents) win.webContents.send('yt-audio', d); });
ipcMain.on('yt-info', (e, d) => { if (win && yt && e.sender === yt.webContents) win.webContents.send('yt-info', d); });
ipcMain.on('web-track', (e, d) => { if (win && yt && e.sender === yt.webContents) { win.webContents.send('web-track', d); win.focus(); } });
if (process.env.DJ_TEST_YT) ipcMain.on('yt-open-test', (e, url) => openYouTube(url));  // automated tests only

app.whenReady().then(() => { migrateOldData(); createMain(); });
app.on('window-all-closed', () => app.quit());
