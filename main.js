// Islam Ayman Studio — desktop app (Windows / Mac)
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
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
const STORES = new Set(['settings', 'franco', 'history']);
function ensure() { fs.mkdirSync(LIB(), { recursive: true }); }
function writeAtomic(file, data) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); }
function readJson(file, def) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return def; } }

ipcMain.handle('store-get', (e, name) => STORES.has(name) ? readJson(path.join(DATA(), name + '.json'), null) : null);
ipcMain.handle('store-set', (e, name, value) => {
  if (!STORES.has(name)) return false; ensure();
  writeAtomic(path.join(DATA(), name + '.json'), JSON.stringify(value, null, 1)); return true;
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
function openYouTube(url) {
  if (yt) { yt.loadURL(url); yt.focus(); return; }
  yt = new BrowserWindow({
    width: 1100, height: 760, title: 'Islam Ayman Studio', autoHideMenuBar: true, backgroundColor: '#000',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'yt-preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  yt.webContents.setUserAgent(yt.webContents.getUserAgent().replace(/\s(Electron|dj-islam-ayman-studio|islam-ayman-edits|islam-ayman-studio)\/\S+/gi, ''));
  yt.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  yt.on('closed', () => { yt = null; if (win) win.webContents.send('yt-closed'); });
  yt.loadURL(url);
}
ipcMain.on('yt-open', (e, url) => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) openYouTube(url); });   // YouTube, Shazam, SoundCloud, any site
ipcMain.on('yt-close', () => { if (yt) yt.close(); });
ipcMain.on('yt-audio', (e, d) => { if (win && yt && e.sender === yt.webContents) win.webContents.send('yt-audio', d); });
ipcMain.on('yt-info', (e, d) => { if (win && yt && e.sender === yt.webContents) win.webContents.send('yt-info', d); });
ipcMain.on('web-track', (e, d) => { if (win && yt && e.sender === yt.webContents) { win.webContents.send('web-track', d); win.focus(); } });
if (process.env.DJ_TEST_YT) ipcMain.on('yt-open-test', (e, url) => openYouTube(url));  // automated tests only

app.whenReady().then(() => { migrateOldData(); createMain(); });
app.on('window-all-closed', () => app.quit());
