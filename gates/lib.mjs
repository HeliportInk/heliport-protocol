// Gate plumbing: tiny harness, static server, headless browser, synthetic network fixtures, scanners.
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- harness ---------- */
export const results = [];
export async function gate(id, name, fn) {
  const t0 = Date.now();
  let ok = true, detail = '';
  try { detail = (await fn()) || ''; } catch (e) { ok = false; detail = e && e.message ? e.message : String(e); }
  results.push({ id, name, ok, ms: Date.now() - t0, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark} ${id} ${name} (${Date.now() - t0}ms)${detail ? ' - ' + String(detail).split('\n')[0].slice(0, 180) : ''}`);
  if (!ok && String(detail).includes('\n')) console.log(String(detail).split('\n').slice(1).map((l) => '     ' + l).join('\n'));
}
export const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/* ---------- static server ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
export function serve(dirIn) {
  const dir = resolve(dirIn);
  return new Promise((res) => {
    const s = createServer((req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = join(dir, p);
      if (!f.startsWith(dir) || !existsSync(f) || !statSync(f).isFile()) { rsp.writeHead(404); rsp.end('nf'); return; }
      rsp.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' });
      rsp.end(readFileSync(f));
    }).listen(0, '127.0.0.1', () => res({ url: `http://127.0.0.1:${s.address().port}`, close: () => s.close() }));
  });
}

/* ---------- synthetic network fixtures ---------- */
export const NATIVE = '0x0000000000000000000000000000000000000000';
const pair = (i, base, quote, vol, liq, chg, dex = 'uniswap', labels = ['v4']) => ({
  chainId: 'robinhood', dexId: dex, labels, url: `https://dexscreener.com/robinhood/0x${String(i).repeat(64).slice(0, 64)}`,
  pairAddress: `0x${String(i).repeat(64).slice(0, 64)}`, baseToken: { address: NATIVE, symbol: base }, quoteToken: { address: '0x' + '11'.repeat(20), symbol: quote },
  priceUsd: String(1000 + i * 3.21), priceChange: { h24: chg }, liquidity: { usd: liq }, volume: { h24: vol },
});
export const PAIR_VOLUMES = [5e6, 4e6, 3e6, 2e6, 1e6, 9e5, 8e5, 7e5];
export const defaultFx = () => ({
  tvl: 1234567890, block: 70123456, gas: 500000000, chainId: 4663,
  rpcStatus: 200, llamaStatus: 200, dexStatus: 200, rpcDelay: 0, hold: null,
  pairs: PAIR_VOLUMES.map((v, i) => pair(i + 1, 'ETH', ['USDG', 'USDC', 'DAI', 'WBTC', 'LINK', 'AAA', 'BBB', 'CCC'][i], v, 1e6 * (8 - i), i % 2 ? -1.5 - i : 2.25 + i)),
  caPairs: [pair(7, 'FIX', 'ETH', 120000, 45000, 3.4), pair(8, 'FIX', 'USDG', 9000, 150000, -0.8)],
  series: [{ date: 1790000000, tvl: 0 }, ...Array.from({ length: 30 }, (_, i) => ({ date: 1790086400 + i * 86400, tvl: 1e9 + i * 8e6 + (i % 5) * 3e6 }))],
});
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const json = (status, body) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });

export async function installFixtures(page, fx, log) {
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const u = new URL(req.url());
    if (u.hostname === '127.0.0.1') return req.continue();
    log.push(req.method() + ' ' + req.url());
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
    if (fx.hold) await fx.hold;
    if (u.hostname === 'rpc.mainnet.chain.robinhood.com') {
      if (fx.rpcDelay) await new Promise((r) => setTimeout(r, fx.rpcDelay));
      if (fx.rpcStatus !== 200) return req.respond(json(fx.rpcStatus, { error: 'down' }));
      const calls = JSON.parse(req.postData() || '[]');
      const answer = (c) => ({ jsonrpc: '2.0', id: c.id, result: c.method === 'eth_chainId' ? '0x' + fx.chainId.toString(16) : c.method === 'eth_blockNumber' ? '0x' + fx.block.toString(16) : '0x' + fx.gas.toString(16) });
      return req.respond(json(200, Array.isArray(calls) ? calls.map(answer) : answer(calls)));
    }
    if (u.hostname === 'api.llama.fi') {
      if (fx.llamaStatus !== 200) return req.respond(json(fx.llamaStatus, { error: 'down' }));
      if (u.pathname === '/v2/chains') return req.respond(json(200, [{ name: 'Other', chainId: 1, tvl: 5 }, { name: 'Robinhood Chain', chainId: 4663, tvl: fx.tvl }]));
      if (u.pathname.startsWith('/v2/historicalChainTvl/')) return req.respond(json(200, fx.series));
    }
    if (u.hostname === 'api.dexscreener.com') {
      if (fx.dexStatus !== 200) return req.respond(json(fx.dexStatus, { error: 'down' }));
      if (u.pathname === `/token-pairs/v1/robinhood/${NATIVE}`) return req.respond(json(200, fx.pairs));
      if (u.pathname.startsWith('/token-pairs/v1/robinhood/0x')) return req.respond(json(200, fx.caPairs));
    }
    return req.abort('blockedbyclient');
  });
}

/* ---------- browser ---------- */
export const SIZES = [360, 390, 430, 1366, 1440];
export const heightFor = (w) => (w < 500 ? 800 : w < 1400 ? 768 : 900);
export function findBrowser() {
  const c = [process.env.HELIPORT_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return c.find((p) => p && existsSync(p));
}
export async function launch() {
  const puppeteer = (await import('puppeteer-core')).default;
  const executablePath = findBrowser();
  if (!executablePath) throw new Error('no Chromium-family browser found; set HELIPORT_BROWSER');
  return puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
}
export async function open(browser, base, o = {}) {
  const { w = 1440, scheme = 'light', reduce = false, fx: fxIn, clock = 0.02, path = '/' } = o;
  const fx = Object.assign(defaultFx(), fxIn || {});
  const page = await browser.newPage();
  const log = [], errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport({ width: w, height: o.h || heightFor(w), deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }]);
  await page.evaluateOnNewDocument((c) => {
    window.__HELI_CLOCK = c;
    window.__copied = [];
    try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(t); } } }); } catch { /* keep native */ }
  }, clock);
  await installFixtures(page, fx, log);
  await page.goto(base + path, { waitUntil: 'load' });
  return { page, fx, log, errors, close: () => page.close() };
}
export const liveReady = (page, timeout = 8000) => page.waitForFunction(
  () => ['tvl', 'block', 'gas', 'vol'].every((k) => { const e = document.querySelector(`[data-live="${k}"]`); return e && !e.querySelector('.skel') && e.textContent.trim() && e.textContent.trim() !== '—'; })
    && !document.querySelector('#pairs-body [data-skel]') && !document.querySelector('#spark-skel:not([hidden])'),
  { timeout });

/* ---------- scanners (pure, unit-testable on synthetic strings) ---------- */
const JOIN = (...p) => p.join('');
export const COLOR_LITERALS = [
  /#[0-9a-fA-F]{3,8}\b/g,
  /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/g,
  /(?<![\w-])color\((?!-)/g,
  /:\s*[^;{}"']*\b(?:black|white|gray|grey|red|green|blue|yellow|orange|purple|pink|silver|navy|teal|lime|maroon|aqua|fuchsia|olive|brown)\b/gi,
];
export const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
export function findColorLiterals(text) {
  const out = [];
  for (const re of COLOR_LITERALS) for (const m of text.matchAll(re)) out.push(m[0].trim());
  return out;
}
export const AI_MARKERS = [
  new RegExp(JOIN('co-?auth', 'ored-by'), 'i'),
  new RegExp(JOIN('generated ', 'with'), 'i'),
  new RegExp('\\b' + JOIN('cla', 'ude') + '\\b', 'i'),
  new RegExp(JOIN('anthr', 'opic'), 'i'),
  new RegExp(JOIN('chat', 'gpt'), 'i'),
  new RegExp('\\b' + JOIN('open', 'ai') + '\\b', 'i'),
  new RegExp(JOIN('ai-', 'generated'), 'i'),
];
export function walk(dir, skip = ['node_modules', '.git'], out = []) {
  for (const n of readdirSync(dir)) {
    if (skip.includes(n)) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, skip, out) : out.push(p);
  }
  return out;
}
const fnv = (s) => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; } return x.toString(36); };
export const bigrams = (text) => {
  const out = [];
  const segs = text.toLowerCase().replace(/&[a-z#0-9]+;/g, ' ').split(/[.!?;:|\n\r]+|\s\.\s/);
  for (const s of segs) { const w = s.match(/[a-z0-9]+/g) || []; for (let i = 0; i < w.length - 1; i++) out.push(w[i] + ' ' + w[i + 1]); }
  return out;
};
export const refHashes = () => new Set(JSON.parse(readFileSync(join(ROOT, 'gates/fixtures/ref-bigrams.json'), 'utf8')).hashes);
export const hashOf = fnv;
// Proper nouns the page cannot avoid naming; everything else must be original.
export const BIGRAM_ALLOW = new Set(['robinhood chain']);
export const parseColor = (s) => {
  let m = s.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  m = s.match(/^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)/);
  if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255];
  return null;
};
export const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
