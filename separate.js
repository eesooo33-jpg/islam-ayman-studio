// Vocal / music separation (Spleeter 2-stems, ONNX) — runs offline on the computer.
// Used to remove a word or a voice from part of a song while keeping the music under it.
const path = require('path');
const N = 4096, HOP = 1024, BINS = N / 2 + 1, F = 1024, T = 512, EPS = 1e-10;
let ort = null, sess = null;

const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); // periodic Hann
const rev = new Uint32Array(N); for (let i = 0, b = Math.log2(N); i < N; i++) { let r = 0; for (let k = 0; k < b; k++) r |= ((i >> k) & 1) << (b - 1 - k); rev[i] = r; }
const cosT = new Float64Array(N / 2), sinT = new Float64Array(N / 2);
for (let i = 0; i < N / 2; i++) { cosT[i] = Math.cos(-2 * Math.PI * i / N); sinT[i] = Math.sin(-2 * Math.PI * i / N); }
function fft(re, im, inverse) {
  for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  const sg = inverse ? -1 : 1;
  for (let size = 2; size <= N; size <<= 1) { const h = size >> 1, step = N / size;
    for (let s = 0; s < N; s += size) for (let k = 0; k < h; k++) { const a = s + k, b = a + h, c = cosT[k * step], d = sg * sinT[k * step];
      const tr = re[b] * c - im[b] * d, ti = re[b] * d + im[b] * c; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; } }
}
function stft(x) { // x already padded; returns frames x BINS complex
  const nF = Math.floor((x.length - N) / HOP) + 1, RE = new Float32Array(nF * BINS), IM = new Float32Array(nF * BINS);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < nF; f++) { for (let i = 0; i < N; i++) { re[i] = x[f * HOP + i] * win[i]; im[i] = 0; } fft(re, im, false);
    for (let k = 0; k < BINS; k++) { RE[f * BINS + k] = re[k]; IM[f * BINS + k] = im[k]; } }
  return { RE, IM, nF };
}
function istft(RE, IM, nF, len) {
  const out = new Float64Array(len), norm = new Float64Array(len), re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < nF; f++) {
    for (let k = 0; k < BINS; k++) { re[k] = RE[f * BINS + k]; im[k] = IM[f * BINS + k]; }
    for (let k = 1; k < N / 2; k++) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    fft(re, im, true);
    for (let i = 0; i < N; i++) { const p = f * HOP + i; if (p >= len) break; out[p] += re[i] / N * win[i]; norm[p] += win[i] * win[i]; }
  }
  const y = new Float32Array(len); for (let i = 0; i < len; i++) y[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0; return y;
}
async function load(modelDir) {
  if (sess) return sess;
  ort = ort || require('onnxruntime-node');
  sess = { v: await ort.InferenceSession.create(path.join(modelDir, 'vocals.fp16.onnx')),
           a: await ort.InferenceSession.create(path.join(modelDir, 'accompaniment.fp16.onnx')) };
  return sess;
}
// L, R: Float32Array @44100 Hz. Returns {music:[L,R], vocals:[L,R]}
async function separate(modelDir, L, R) {
  const s = await load(modelDir), len = L.length;
  const pad = x => { const y = new Float32Array(len + 2 * N); y.set(x, N); return y; };
  const S = [stft(pad(L)), stft(pad(R))], nF = S[0].nF, splits = Math.ceil(nF / T);
  const x = new Float32Array(2 * splits * T * F);
  for (let c = 0; c < 2; c++) for (let f = 0; f < nF; f++) { const o = (c * splits * T + f) * F, b = f * BINS;
    for (let k = 0; k < F; k++) { const r = S[c].RE[b + k], i = S[c].IM[b + k]; x[o + k] = Math.sqrt(r * r + i * i); } }
  const feeds = { x: new ort.Tensor('float32', x, [2, splits, T, F]) };
  const v = (await s.v.run(feeds)).y.data, a = (await s.a.run(feeds)).y.data;
  const res = { music: [], vocals: [] };
  for (let c = 0; c < 2; c++) {
    const MR = new Float32Array(nF * BINS), MI = new Float32Array(nF * BINS), VR = new Float32Array(nF * BINS), VI = new Float32Array(nF * BINS);
    for (let f = 0; f < nF; f++) {
      const o = (c * splits * T + f) * F, b = f * BINS; let hi = 0;
      for (let k = 0; k < BINS; k++) {
        let m;
        if (k < F) { const vv = v[o + k] ** 2, aa = a[o + k] ** 2; m = (aa + EPS / 2) / (vv + aa + EPS); if (k >= 768) hi += m / 256; }
        else m = hi; // above 11 kHz: use the average of the top band
        const re = S[c].RE[b + k], im = S[c].IM[b + k];
        MR[b + k] = re * m; MI[b + k] = im * m; VR[b + k] = re * (1 - m); VI[b + k] = im * (1 - m);
      }
    }
    res.music.push(istft(MR, MI, nF, len + 2 * N).subarray(N, N + len).slice());
    res.vocals.push(istft(VR, VI, nF, len + 2 * N).subarray(N, N + len).slice());
  }
  return res;
}
module.exports = { separate };

// Whole song: separate in 30 s pieces with overlap (keeps memory low), blend the joins.
async function separateLong(modelDir, L, R) {
  const SR = 44100, CH = 30 * SR, OV = 2 * SR, n = L.length;
  const out = { mL: new Float32Array(n), mR: new Float32Array(n), vL: new Float32Array(n), vR: new Float32Array(n) };
  for (let s = 0; s < n; s += CH) {
    const a = Math.max(0, s - OV), b = Math.min(n, s + CH + OV);
    const r = await separate(modelDir, L.subarray(a, b), R.subarray(a, b));
    const src = [r.music[0], r.music[1], r.vocals[0], r.vocals[1]], dst = [out.mL, out.mR, out.vL, out.vR];
    for (let c = 0; c < 4; c++) for (let i = a; i < b; i++) {
      const v = src[c][i - a];
      if (s > 0 && i < s + OV) { const w = (i - (s - OV)) / (2 * OV); dst[c][i] = dst[c][i] * (1 - w) + v * w; } else dst[c][i] = v;
    }
  }
  return out;
}
module.exports.separateLong = separateLong;
