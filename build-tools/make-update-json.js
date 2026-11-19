// Writes update.json at the repo root: what the installed programs read to update themselves.
// usage: node build-tools/make-update-json.js <repoDir> <version> <shell> "<notes>"
// <shell> must equal SHELL in updater.js of this version (raise both when main.js/preload.js/... change).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [repo, version, shellV, notes = ''] = process.argv.slice(2);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const files = {};
(function walk(d, rel) {
  for (const n of fs.readdirSync(d).sort()) {
    const p = path.join(d, n), r = rel ? rel + '/' + n : n;
    if (fs.statSync(p).isDirectory()) walk(p, r); else files[r] = sha(p);
  }
})(path.join(repo, 'app'), '');
const parts = fs.readdirSync(path.join(repo, 'Windows-Setup')).filter(n => /^setup\d+\.part$/.test(n)).sort().map(n => 'Windows-Setup/' + n);
const h = crypto.createHash('sha256'); let size = 0;
for (const p of parts) { const b = fs.readFileSync(path.join(repo, p)); h.update(b); size += b.length; }
const out = { version, shell: Number(shellV), notes, app: { files }, installer: { parts, size, sha256: h.digest('hex') } };
fs.writeFileSync(path.join(repo, 'update.json'), JSON.stringify(out, null, 1) + '\n');
console.log('update.json', version, 'shell', shellV, Object.keys(files).length, 'files, installer', size);
