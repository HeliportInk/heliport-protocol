// Image helpers for brand sampling: decode, alpha stats, premultiplied resize, k-means.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

export function readHeader(file) {
  const b = readFileSync(file);
  if (b.slice(1, 4).toString() === 'PNG') {
    return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20), depth: b[24], colorType: b[25], interlace: b[28] };
  }
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return { format: 'jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7), components: b[i + 9] };
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error('no SOF in ' + file);
}

// Returns { width, height, data: Uint8Array RGBA (straight alpha, as stored) }.
export function decode(file) {
  const b = readFileSync(file);
  if (b.slice(1, 4).toString() === 'PNG') {
    const p = PNG.sync.read(b);
    return { width: p.width, height: p.height, data: p.data };
  }
  const j = jpeg.decode(b, { useTArray: true, formatAsRGBA: true });
  return { width: j.width, height: j.height, data: j.data };
}

export function alphaStats(img) {
  const hist = new Array(8).fill(0);
  let pureBlackTransparent = 0, transparent = 0, opaque = 0, partial = 0, edgeBlack = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    const [r, g, b, a] = [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2], img.data[i * 4 + 3]];
    hist[Math.min(7, a >> 5)]++;
    if (a === 0) { transparent++; if (r === 0 && g === 0 && b === 0) pureBlackTransparent++; }
    else if (a === 255) opaque++;
    else { partial++; if (r + g + b < 12) edgeBlack++; }
  }
  return { pixels: n, histogram8: hist, transparent, opaque, partial, pureBlackTransparent, darkPartial: edgeBlack };
}

// Box-filter downscale in PREMULTIPLIED space, then un-premultiply. Straight-alpha averaging would let the
// RGB of transparent pure-black pixels bleed dark fringes into the edges of the artwork.
export function resizePremultiplied(img, w, h) {
  const out = new Uint8Array(w * h * 4);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * img.width + xx) * 4, al = img.data[i + 3];
        r += img.data[i] * al; g += img.data[i + 1] * al; b += img.data[i + 2] * al; a += al; n++;
      }
      const o = (y * w + x) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); out[o + 3] = Math.round(a / n); }
    }
  }
  return { width: w, height: h, data: out };
}

// Deterministic k-means over opaque-enough pixels (k-means++ style seeding with a fixed PRNG).
export function kmeans(img, k, { step = 7, minAlpha = 200, iters = 24, seed = 7 } = {}) {
  const pts = [];
  for (let y = 0; y < img.height; y += step) for (let x = 0; x < img.width; x += step) {
    const i = (y * img.width + x) * 4;
    if (img.data[i + 3] >= minAlpha) pts.push([img.data[i], img.data[i + 1], img.data[i + 2], x, y]);
  }
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const d2 = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
  const cent = [pts[Math.floor(rnd() * pts.length)].slice(0, 3)];
  while (cent.length < k) {
    const w = pts.map((p) => Math.min(...cent.map((c) => d2(p, c))));
    const sum = w.reduce((a, b) => a + b, 0);
    let t = rnd() * sum, idx = 0;
    for (; idx < w.length - 1 && t > w[idx]; idx++) t -= w[idx];
    cent.push(pts[idx].slice(0, 3));
  }
  let assign = new Array(pts.length).fill(0);
  for (let it = 0; it < iters; it++) {
    assign = pts.map((p) => { let bi = 0, bd = Infinity; cent.forEach((c, i) => { const d = d2(p, c); if (d < bd) { bd = d; bi = i; } }); return bi; });
    const acc = cent.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => { const a = acc[assign[i]]; a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++; });
    acc.forEach((a, i) => { if (a[3]) cent[i] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  const counts = cent.map(() => 0);
  assign.forEach((a) => counts[a]++);
  return cent.map((c, i) => ({ centroid: c, share: counts[i] / pts.length, members: pts.filter((_, j) => assign[j] === i) }))
    .sort((a, b) => b.share - a.share);
}

// Snap a centroid to the nearest REAL pixel (by RGB distance) and report where it lives.
export function snapToPixel(cluster) {
  const c = cluster.centroid;
  let best = null, bd = Infinity;
  for (const m of cluster.members) {
    const d = (m[0] - c[0]) ** 2 + (m[1] - c[1]) ** 2 + (m[2] - c[2]) ** 2;
    if (d < bd) { bd = d; best = m; }
  }
  return { rgb: [best[0], best[1], best[2]], x: best[3], y: best[4] };
}

export const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
export const pixelAt = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]; };
