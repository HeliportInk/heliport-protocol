// npm run palette — samples brand/ and reference/, writes src/tokens.css and src/assets/*.
// Every colour in tokens.css is a REAL pixel of a supplied asset: either a k-means cluster centre snapped to
// the nearest pixel that belongs to the cluster, or a role target snapped to the nearest pixel in the asset pool.
// The provenance table in the generated file records file and pixel coordinate; a gate re-reads each pixel.
import { writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { readHeader, decode, alphaStats, kmeans, snapToPixel, hex, pixelAt, resizePremultiplied } from './lib/image.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => p.replace(/\\/g, '/');
const OPAQUE_LOGO = 'brand/LOGO HELIPORT PNG.png';
const ALPHA_LOGO = 'brand/LOGO HELIPORT PNG...png';
const SLIDE = 'reference/HELIPORT 1.jpg.jpeg';
const files = [...readdirSync(join(ROOT, 'brand')).map((f) => 'brand/' + f), ...readdirSync(join(ROOT, 'reference')).map((f) => 'reference/' + f)].sort();

const imgs = {};
const report = {};
for (const f of files) {
  const img = decode(join(ROOT, f));
  imgs[f] = img;
  report[f] = { header: readHeader(join(ROOT, f)), alpha: alphaStats(img) };
}

/* ---- alpha findings decide the resize path ---- */
const a = report[ALPHA_LOGO].alpha;
const premultiply = a.pureBlackTransparent > 0;

/* ---- pixel pool for snapping: opaque pixels only ---- */
const pool = [];
for (const f of files) {
  const im = imgs[f], step = f.startsWith('brand/') ? 5 : 4;
  for (let y = 0; y < im.height; y += step) for (let x = 0; x < im.width; x += step) {
    const [r, g, b, al] = pixelAt(im, x, y);
    if (al === 255) pool.push([r, g, b, f, x, y]);
  }
}
const near = (t, only) => {
  let best = null, bd = Infinity;
  for (const p of pool) {
    if (only && !only(p[3])) continue;
    const d = (p[0] - t[0]) ** 2 + (p[1] - t[1]) ** 2 + (p[2] - t[2]) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return { rgb: best.slice(0, 3), file: best[3], x: best[4], y: best[5], dist: Math.sqrt(bd) };
};
const cluster = (file, rank, k = 6) => {
  const c = kmeans(imgs[file], k, { minAlpha: 255 })[rank];
  const s = snapToPixel(c);
  return { rgb: s.rgb, file, x: s.x, y: s.y, how: `kmeans k=${k} rank ${rank} (${(c.share * 100).toFixed(1)}% of opaque samples)` };
};
const snap = (target, only) => { const n = near(target, only); return { ...n, how: `snap target ${hex(target)} dist ${n.dist.toFixed(1)}` }; };
const mix = (a1, b1, t) => a1.map((v, i) => Math.round(v + (b1[i] - v) * t));
const logos = (f) => f.startsWith('brand/');

const navy = cluster(SLIDE, 0), navy2 = cluster(SLIDE, 1), cyan = cluster(SLIDE, 4), midblue = cluster(SLIDE, 3);
const blue = cluster(OPAQUE_LOGO, 0);
const cream = cluster(OPAQUE_LOGO, 1);
if (cream.rgb.join() === '0,0,0') throw new Error('cream cluster is the transparent black fill; alpha filter failed');

const L = {
  bg: cream, 'bg-alt': snap(mix(cream.rgb, blue.rgb, 0.04), logos), ink: navy,
  muted: snap([62, 84, 122]), line: snap(mix(cream.rgb, navy.rgb, 0.14), logos),
  accent: blue, 'accent-ink': snap([255, 255, 255]), 'accent-soft': snap(mix(cream.rgb, blue.rgb, 0.1), logos),
  'warn-bg': snap(mix(cream.rgb, blue.rgb, 0.04), logos), 'warn-line': snap(mix(cream.rgb, navy.rgb, 0.4), logos),
  'skel-a': snap(mix(cream.rgb, blue.rgb, 0.08), logos), 'skel-b': cream, flash: snap(mix(cream.rgb, blue.rgb, 0.3), logos), shade: navy,
};
const D = {
  bg: navy, 'bg-alt': navy2, ink: cream,
  muted: snap([150, 176, 214]), line: snap([10, 50, 112]),
  accent: cyan, 'accent-ink': navy, 'accent-soft': snap([3, 36, 90]),
  'warn-bg': navy2, 'warn-line': snap([20, 70, 140]),
  'skel-a': navy2, 'skel-b': snap([0, 45, 110]), flash: midblue, shade: snap([0, 6, 18]),
};

/* ---- contrast guard ---- */
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const cr = (p, q) => { const [x, y] = [lum(p), lum(q)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const checks = [];
for (const [name, S] of [['light', L], ['dark', D]]) {
  checks.push([`${name} ink/bg`, cr(S.ink.rgb, S.bg.rgb), 7], [`${name} muted/bg`, cr(S.muted.rgb, S.bg.rgb), 4.5], [`${name} muted/bg-alt`, cr(S.muted.rgb, S['bg-alt'].rgb), 4.5], [`${name} accent-ink/accent`, cr(S['accent-ink'].rgb, S.accent.rgb), 4.5], [`${name} accent/bg`, cr(S.accent.rgb, S.bg.rgb), 3]);
}
for (const [n, v, min] of checks) if (v < min) throw new Error(`contrast ${n} = ${v.toFixed(2)} < ${min}`);

/* ---- tokens.css ---- */
const row = (scheme, k, s) => ` * ${scheme} | --${k} | ${hex(s.rgb)} | ${s.file} | ${s.x},${s.y} | ${s.how}`;
const prov = [...Object.entries(L).map(([k, s]) => row('light', k, s)), ...Object.entries(D).map(([k, s]) => row('dark', k, s))].join('\n');
const block = (S, indent) => Object.entries(S).map(([k, s]) => `${indent}--${k}: ${hex(s.rgb)};`).join('\n') + '\n' + `${indent}--ok: var(--ink);\n${indent}--public: var(--muted);`;
const css = `/*
  Colour tokens. The ONLY file in the project allowed to hold colour literals.
  Generated by scripts/sample-palette.mjs. Do not edit by hand; edit the roles there and rerun.

  PALETTE PROVENANCE
  Method: deterministic k-means (k=6, stride-7 sampling, alpha=255 pixels only, fixed seed) per asset. A cluster
  centre is snapped to the nearest pixel INSIDE that cluster; role targets without a cluster are snapped to the
  nearest opaque pixel of the whole asset pool. Every value below is a real pixel at the stated coordinate.
  Alpha handling: ${ALPHA_LOGO} is RGBA (colour type ${report[ALPHA_LOGO].header.colorType}) with ${a.pureBlackTransparent} fully transparent pixels stored as
  pure black (0,0,0,0); they were excluded from sampling and resizes use premultiplied alpha.
  Rows: scheme | token | hex | file | x,y | how
${prov}
*/
:root {
${block(L, '  ')}
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${block(D, '    ')}
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
${block(D, '  ')}
  color-scheme: dark;
}
`;
writeFileSync(join(ROOT, 'src/tokens.css'), css);

/* ---- favicon and brand mark from the real logo pixel grid ---- */
const mark = imgs[ALPHA_LOGO];
let x0 = mark.width, y0 = mark.height, x1 = 0, y1 = 0;
for (let y = 0; y < mark.height; y++) for (let x = 0; x < mark.width; x++) if (mark.data[(y * mark.width + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
const side = Math.round(Math.max(x1 - x0, y1 - y0) * 1.32);
const cx = Math.round((x0 + x1) / 2), cy = Math.round((y0 + y1) / 2);
const crop = { width: side, height: side, data: new Uint8Array(side * side * 4) };
for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
  const sx = cx - (side >> 1) + x, sy = cy - (side >> 1) + y;
  if (sx < 0 || sy < 0 || sx >= mark.width || sy >= mark.height) continue;
  const si = (sy * mark.width + sx) * 4, di = (y * side + x) * 4;
  crop.data.set(mark.data.subarray(si, si + 4), di);
}
const tile = (n, round) => {
  const m = resizePremultiplied(crop, n, n);
  const png = new PNG({ width: n, height: n });
  const R = n * 0.22;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    const al = m.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) png.data[i + c] = Math.round(m.data[i + c] * al + blue.rgb[c] * (1 - al));
    let cov = 1;
    if (round) {
      let hit = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4;
        const dx = Math.max(R - px, 0, px - (n - R)), dy = Math.max(R - py, 0, py - (n - R));
        if (dx * dx + dy * dy <= R * R) hit++;
      }
      cov = hit / 16;
    }
    png.data[i + 3] = Math.round(255 * cov);
  }
  return PNG.sync.write(png);
};
const out = join(ROOT, 'src/assets');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'favicon-32.png'), tile(32, true));
writeFileSync(join(out, 'favicon-64.png'), tile(64, true));
writeFileSync(join(out, 'apple-touch-icon.png'), tile(180, false));
writeFileSync(join(out, 'brand-mark.png'), tile(128, true));
copyFileSync(join(ROOT, 'reference/SAMPUL HELIPORT JPG.jpg.jpeg'), join(out, 'share-card.jpg'));
writeFileSync(join(out, 'PROVENANCE.txt'), `Generated by scripts/sample-palette.mjs from ${ALPHA_LOGO} (mark, premultiplied resize: ${premultiply}) over ${hex(blue.rgb)} sampled from ${OPAQUE_LOGO} at ${blue.x},${blue.y}.\nshare-card.jpg is reference/SAMPUL HELIPORT JPG.jpg.jpeg copied unchanged.\n`);

console.log(JSON.stringify({ premultiply, pureBlackTransparent: a.pureBlackTransparent, mark: { x0, y0, x1, y1, side }, files: Object.fromEntries(files.map((f) => [f, `${report[f].header.format} ${report[f].header.width}x${report[f].header.height} ct=${report[f].header.colorType ?? 'jpeg'}`])) }, null, 1));
console.log(checks.map(([n, v]) => `${n} ${v.toFixed(2)}`).join('\n'));
