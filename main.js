// Islam Ayman Studio — desktop app (Windows / Mac)
const { app, BrowserWindow, ipcMain, shell } = require('electron');
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

/* ---------- AI: remove vocals from a part, keep the music ---------- */
const MODELS = () => app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(__dirname, 'models');
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
    width: 1000, height: 620, title: 'YouTube · Islam Ayman Studio', autoHideMenuBar: true, backgroundColor: '#000',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'yt-preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  yt.webContents.setUserAgent(yt.webContents.getUserAgent().replace(/\s(Electron|dj-islam-ayman-studio|islam-ayman-edits|islam-ayman-studio)\/\S+/gi, ''));
  yt.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  yt.on('closed', () => { yt = null; if (win) win.webContents.send('yt-closed'); });
  yt.loadURL(url);
}
ipcMain.on('yt-open', (e, url) => { if (typeof url === 'string' && YT_RE.test(url)) openYouTube(url); });
ipcMain.on('yt-close', () => { if (yt) yt.close(); });
ipcMain.on('yt-audio', (e, d) => { if (win && yt && e.sender === yt.webContents) win.webContents.send('yt-audio', d); });
if (process.env.DJ_TEST_YT) ipcMain.on('yt-open-test', (e, url) => openYouTube(url));  // automated tests only

app.whenReady().then(() => { migrateOldData(); createMain(); });
app.on('window-all-closed', () => app.quit());
