// Islam Ayman Studio — automatic updates
// The program checks GitHub for "update.json". Two kinds of update:
//  • quick update  — only the screens/features (the app folder) changed: the new files are downloaded,
//                    checked, and used right away (or on the next start). Nothing to install.
//  • full update   — the program core changed: the new installer is downloaded in the background,
//                    checked, and installed silently (the program reopens by itself).
// Everything downloaded is checked with SHA-256 against update.json before it is used.
const { app, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SHELL = 1;   // raise this whenever main.js / preload.js / separate.js / yt-preload.js / packages change
const BASE = process.env.DJ_UPDATE_BASE || 'https://raw.githubusercontent.com/eesooo33-jpg/islam-ayman-studio/main/';
const HOT = () => path.join(app.getPath('userData'), 'hot');
const DL = () => path.join(app.getPath('userData'), 'updates');
const BUNDLED_APP = path.join(__dirname, 'app');

function cmp(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }

// the quick update currently in use (if it is newer than the installed program and fits this core)
function hotInfo() {
  const cur = readJson(path.join(HOT(), 'current.json'));
  if (!cur || !cur.version || (cur.shell || 0) > SHELL || cmp(cur.version, app.getVersion()) <= 0) return null;
  const dir = path.join(HOT(), cur.version);
  return fs.existsSync(path.join(dir, 'index.html')) ? { version: cur.version, dir } : null;
}
function appDir() { const h = hotInfo(); return h ? h.dir : BUNDLED_APP; }
function version() { const h = hotInfo(); return h ? h.version : app.getVersion(); }

async function get(url, asJson) {
  const r = await net.fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return asJson ? r.json() : Buffer.from(await r.arrayBuffer());
}

let state = { status: 'idle', version: null, kind: null, notes: '', progress: 0, error: '' };
let notify = () => {};
let installerPath = null, busy = false;
function set(p) { state = { ...state, ...p }; notify(state); }

async function quickUpdate(info) {
  const files = info.app && info.app.files; if (!files) throw new Error('no files');
  const tmp = path.join(HOT(), info.version + '.tmp'), dest = path.join(HOT(), info.version);
  fs.rmSync(tmp, { recursive: true, force: true });
  const from = appDir(), names = Object.keys(files); let done = 0;
  for (const name of names) {
    if (name.includes('..') || path.isAbsolute(name)) throw new Error('bad file name');
    let buf = null;
    try { const local = fs.readFileSync(path.join(from, name)); if (sha(local) === files[name]) buf = local; } catch (e) {}
    if (!buf) { buf = await get(BASE + 'app/' + name.split('/').map(encodeURIComponent).join('/')); if (sha(buf) !== files[name]) throw new Error('checksum ' + name); }
    const out = path.join(tmp, name); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, buf);
    set({ progress: Math.round(++done / names.length * 100) });
  }
  fs.rmSync(dest, { recursive: true, force: true }); fs.renameSync(tmp, dest);
  fs.writeFileSync(path.join(HOT(), 'current.json'), JSON.stringify({ version: info.version, shell: info.shell || 0 }));
  // keep only the newest quick update
  for (const d of fs.readdirSync(HOT())) if (d !== info.version && d !== 'current.json') fs.rmSync(path.join(HOT(), d), { recursive: true, force: true });
}

async function fullUpdate(info) {
  const ins = info.installer; if (!ins || !ins.parts || !ins.sha256) throw new Error('no installer');
  fs.mkdirSync(DL(), { recursive: true });
  const file = path.join(DL(), 'Islam-Ayman-Studio-Setup-' + info.version + '.exe');
  if (fs.existsSync(file) && sha(fs.readFileSync(file)) === ins.sha256) { installerPath = file; return; }
  const tmp = file + '.part'; fs.rmSync(tmp, { force: true });
  let got = 0;
  for (const p of ins.parts) {
    const r = await net.fetch(BASE + p + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const reader = r.body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      fs.appendFileSync(tmp, value); got += value.length; set({ progress: Math.min(99, Math.round(got / (ins.size || 1) * 100)) }); }
  }
  if (sha(fs.readFileSync(tmp)) !== ins.sha256) { fs.rmSync(tmp, { force: true }); throw new Error('checksum installer'); }
  fs.renameSync(tmp, file); installerPath = file;
  for (const f of fs.readdirSync(DL())) if (path.join(DL(), f) !== file) fs.rmSync(path.join(DL(), f), { force: true });
}

async function check() {
  if (busy) return state; busy = true;
  try {
    set({ status: 'checking', error: '' });
    const info = await get(BASE + 'update.json', true);
    if (!info || !info.version || cmp(info.version, version()) <= 0) { set({ status: 'latest', version: version() }); return state; }
    const kind = (info.shell || 0) <= SHELL ? 'quick' : 'full';
    if (kind === 'full' && process.platform !== 'win32' && !process.env.DJ_UPDATE_TEST) { set({ status: 'manual', version: info.version, kind, notes: info.notes || '' }); return state; }
    set({ status: 'downloading', version: info.version, kind, notes: info.notes || '', progress: 0 });
    if (kind === 'quick') await quickUpdate(info); else await fullUpdate(info);
    set({ status: 'ready', progress: 100 });
  } catch (e) {
    set({ status: 'error', error: String(e && e.message || e) });
  } finally { busy = false; }
  return state;
}

// full update: run the installer silently; it closes this program, installs, and reopens it
function installNow(reopen = true) {
  if (!installerPath || !fs.existsSync(installerPath)) return false;
  app.__updInstalling = true;
  try { const c = spawn(installerPath, reopen ? ['/S', '/R'] : ['/S'], { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref(); } catch (e) { return false; }
  setTimeout(() => app.quit(), 300);
  return true;
}

function start(onState) {
  notify = onState || notify;
  setTimeout(check, 8000);
  setInterval(check, 4 * 3600 * 1000);
  // a full update that was downloaded but not installed yet is installed when the program is closed
  app.on('before-quit', () => {
    if (state.status === 'ready' && state.kind === 'full' && installerPath && !app.__updInstalling) {
      app.__updInstalling = true;
      try { const c = spawn(installerPath, ['/S'], { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref(); } catch (e) {}
    }
  });
}

function markApplied() { state = { ...state, status: 'latest', version: version() }; }

module.exports = { start, check, installNow, markApplied, appDir, version, getState: () => state, SHELL };
