// npm run gates. Synthetic fixtures only (no real network), a fast animation clock, one browser.
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, extname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT, gate, assert, results, serve, launch, open, liveReady, SIZES, heightFor, PAIR_VOLUMES,
  findColorLiterals, stripComments, AI_MARKERS, walk, bigrams, refHashes, hashOf, BIGRAM_ALLOW, parseColor, contrast,
} from './lib.mjs';
import { readHeader, decode, alphaStats, pixelAt, hex as toHex, resizePremultiplied } from '../scripts/lib/image.mjs';
import { build } from '../scripts/build.mjs';
import { validateRegistry, isAddress, classifyHex, deriveHandle, STATES } from '../src/register.js';
import { REGISTRY } from '../src/registry.js';

const T0 = Date.now();
const BUDGET_MS = 300000;
const dist = join(ROOT, 'dist');
const tmp = mkdtempSync(join(tmpdir(), 'heliport-gates-'));

/* ---------- synthetic registries (fixtures live in a temp dir, never in the project) ---------- */
const FIX_ADDR = '0x' + 'aB'.repeat(20);
const fixtureRegistry = (name, overrides) => {
  const reg = { ...REGISTRY, ...overrides };
  const file = join(tmp, name + '.mjs');
  writeFileSync(file, 'export const REGISTRY = ' + JSON.stringify(reg) + ';');
  return file;
};
const statedFile = fixtureRegistry('stated', {
  ca: { state: 'stated', value: FIX_ADDR },
  x: { state: 'stated', url: 'https://x.com/HeliportINK' },
  github: { state: 'unconfirmed', value: 'heliport-fixture', url: 'https://github.com/heliport-fixture' },
  ticker: { state: 'stated', value: 'FIX' },
});
const statedDir = join(tmp, 'dist-stated');

const text = (f) => readFileSync(f, 'utf8');
const SRC_FILES = () => walk(join(ROOT, 'src')).filter((f) => ['.css', '.js', '.html'].includes(extname(f)));
const px = (v) => parseFloat(v);

let browser, base, baseStated;

async function main() {
  console.log('heliport gates: fixtures only, fast clock, budget ' + BUDGET_MS / 1000 + 's');
  await build({ out: dist });
  await build({ registryPath: statedFile, out: statedDir });
  const srv = await serve(dist);
  const srvStated = await serve(statedDir);
  base = srv.url; baseStated = srvStated.url;
  browser = await launch();
  { const w = await open(browser, base, {}); await liveReady(w.page, 30000).catch(() => {}); await w.close(); } // warm-up: cold browser start is not what the gates measure

  /* ===== static ===== */
  await gate('G01', 'build outputs exist and are non-empty', () => {
    for (const f of ['index.html', 'site.css', 'site.js', 'favicon-32.png', 'favicon-64.png', 'apple-touch-icon.png', 'brand-mark.png', 'share-card.jpg']) assert(existsSync(join(dist, f)) && readFileSync(join(dist, f)).length > 50, 'missing ' + f);
    assert(!/{{/.test(text(join(dist, 'index.html'))), 'unresolved slot');
  });

  await gate('G02', 'register: schema, states, rejection of bad records', () => {
    assert(validateRegistry(REGISTRY).length === 0, validateRegistry(REGISTRY).join('; '));
    for (const [k, r] of Object.entries(REGISTRY)) assert(STATES.includes(r.state), k + ' has bad state');
    const bad = [
      { a: { state: 'maybe' } },
      { a: { state: 'stated' } },
      { a: { state: 'absent', value: 'x' } },
      { ca: { state: 'stated', value: '0x123' } },
      { a: { state: 'stated', url: 'not a url' } },
    ];
    for (const b of bad) assert(validateRegistry(b).length > 0, 'accepted ' + JSON.stringify(b));
    assert(validateRegistry({ ca: { state: 'unconfirmed', value: FIX_ADDR } }).length === 0, 'rejected a well-formed unconfirmed address');
  });

  await gate('G03', 'link rule: unstated records render no href, no handle', () => {
    const html = text(join(dist, 'index.html'));
    assert(!/href="https?:\/\/(?:www\.)?(?:x\.com|twitter\.com|github\.com)/i.test(html), 'social href present while absent');
    const socials = html.match(/<div class="socials">([\s\S]*?)<\/div>/)[1];
    assert(!/<a\b/.test(socials), 'anchor inside socials while absent');
    assert((socials.match(/is-inert/g) || []).length === 2, 'expected two inert icons');
    assert(!/@heliport/i.test(html), 'handle shown while absent');
  });

  await gate('G04', 'link rule: stated URL yields href and derived handle; unconfirmed stays plain', () => {
    assert(deriveHandle('https://x.com/HeliportINK') === 'HeliportINK', 'handle derivation');
    assert(deriveHandle('nonsense') === null, 'bad url should yield null');
    const html = text(join(statedDir, 'index.html'));
    const socials = html.match(/<div class="socials">([\s\S]*?)<\/div>\s*<button/)[1];
    assert(/<a class="social" href="https:\/\/x\.com\/HeliportINK"[^>]*aria-label="Heliport on X, HeliportINK"/.test(socials), 'X anchor not derived from stored URL');
    assert(!/github\.com/.test(socials), 'unconfirmed GitHub must not be linked');
    assert(/@HeliportINK/.test(html), 'derived handle not shown in register/footer');
    assert(!/href="https:\/\/github\.com\/heliport-fixture"/.test(html), 'unconfirmed GitHub linked somewhere');
  });

  await gate('G05', 'gate warning: 0x hex is judged by shape, never blanket-rejected', async () => {
    assert(isAddress('0x' + 'a'.repeat(40)) && isAddress(FIX_ADDR) && isAddress('0x' + '0'.repeat(40)), 'valid 20-byte hex rejected');
    for (const bad of ['0x' + 'a'.repeat(39), '0x' + 'a'.repeat(41), '0x' + 'g'.repeat(40), 'ab'.repeat(20), '']) assert(!isAddress(bad), 'accepted ' + bad);
    assert(classifyHex('0x' + 'f'.repeat(64)) === 'hash32', '32-byte hash misclassified');
    assert(classifyHex('0x1237') === 'hex' && classifyHex('hello') === 'other', 'short hex / text misclassified');
    // the colour scanner must not trip on hex-looking data that is not a colour
    assert(findColorLiterals(`const a = "${FIX_ADDR}"; const t = "0x${'f'.repeat(64)}"; href="#faq"`).length === 0, 'colour scanner flagged 0x data');
    assert(findColorLiterals('a{color:#fff}').length === 1, 'colour scanner missed a real literal');
    // a stated address builds cleanly; a malformed one is refused
    assert(text(join(statedDir, 'index.html')).includes(FIX_ADDR), 'stated address missing from build');
    let refused = false;
    try { await build({ registryPath: fixtureRegistry('bad', { ca: { state: 'stated', value: '0x12' } }), out: join(tmp, 'bad') }); } catch { refused = true; }
    assert(refused, 'malformed address was built');
  });

  await gate('G06', 'palette rule: colour literals only in tokens.css, every token is a real sampled pixel', () => {
    const offenders = [];
    for (const f of SRC_FILES()) {
      if (basename(f) === 'tokens.css') continue;
      const hits = findColorLiterals(stripComments(text(f)));
      if (hits.length) offenders.push(relative(ROOT, f) + ': ' + hits.slice(0, 3).join(' '));
    }
    assert(!offenders.length, 'literals outside tokens:\n' + offenders.join('\n'));
    const tokens = text(join(ROOT, 'src/tokens.css'));
    const light = tokens.match(/:root\s*{([^}]*)}/)[1];
    const dark = tokens.match(/:root\[data-theme="dark"\]\s*{([^}]*)}/)[1];
    const decls = (blk) => Object.fromEntries([...blk.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6});/g)].map((m) => [m[1], m[2].toLowerCase()]));
    const prov = {};
    for (const m of tokens.matchAll(/^ \* (light|dark) \| --([\w-]+) \| (#[0-9a-f]{6}) \| ([^|]+) \| (\d+),(\d+) \| (.+)$/gm)) prov[m[1] + ':' + m[2]] = { hex: m[3], file: m[4].trim(), x: +m[5], y: +m[6], how: m[7] };
    assert(/k-means/i.test(tokens) && /snapped|snap/i.test(tokens) && /premultiplied/i.test(tokens), 'provenance comment lacks method or alpha statement');
    const cache = {};
    let checked = 0, chromatic = 0;
    for (const [scheme, blk] of [['light', light], ['dark', dark]]) {
      const d = decls(blk);
      assert(Object.keys(d).length >= 14, scheme + ' tokens missing');
      for (const [name, h] of Object.entries(d)) {
        const p = prov[scheme + ':' + name];
        assert(p, 'no provenance row for ' + scheme + ' --' + name);
        assert(p.hex === h, scheme + ' --' + name + ' differs from its provenance row');
        const img = (cache[p.file] ||= decode(join(ROOT, p.file)));
        const px = pixelAt(img, p.x, p.y);
        assert(px[3] === 255 && toHex(px) === h, `${scheme} --${name} ${h} is not the opaque pixel at ${p.file} ${p.x},${p.y} (found ${toHex(px)} a=${px[3]})`);
        checked++;
        const rgb = parseInt(h.slice(1), 16), r = rgb >> 16, gg = (rgb >> 8) & 255, b = rgb & 255;
        if (Math.max(r, gg, b) - Math.min(r, gg, b) > 30) chromatic++;
      }
    }
    assert(chromatic >= 10, 'palette is not chromatic enough to be the brand: ' + chromatic);
    assert(!/oklch|hsl|rgb/i.test(tokens.replace(/\/\*[\s\S]*?\*\//g, '')), 'tokens must be plain hex');
    return checked + ' tokens verified against real pixels';
  });

  await gate('G07', 'repo hygiene: no agent files, no AI attribution', () => {
    const files = walk(ROOT);
    const names = files.map((f) => relative(ROOT, f).replace(/\\/g, '/'));
    const agent = ['cla', 'ude'].join('');
    assert(!names.some((n) => n.toLowerCase().split('/').some((seg) => seg === '.' + agent || seg === agent + '.md')), 'agent config present');
    const hits = [];
    for (const f of files) {
      if (!/\.(md|json|mjs|js|css|html|svg|txt|ya?ml)$/i.test(f) || /package-lock\.json$/.test(f)) continue;
      const t = text(f);
      for (const re of AI_MARKERS) if (re.test(t)) hits.push(relative(ROOT, f) + ' ~ ' + re.source);
    }
    assert(!hits.length, hits.join('\n'));
  });

  await gate('G08', 'no ch units in styles, scripts or markup', () => {
    const hits = [];
    for (const f of SRC_FILES().concat([join(dist, 'index.html')])) {
      const t = stripComments(text(f));
      const m = t.match(/(?<![\w-])\d*\.?\d+\s*ch\b/g);
      if (m) hits.push(relative(ROOT, f) + ': ' + m.join(', '));
    }
    assert(!hits.length, hits.join('\n'));
  });

  await gate('G09', 'copy: zero word pairs shared with the reference (hash check)', async () => {
    const { page, close } = await open(browser, base, {});
    await liveReady(page);
    const dom = await page.evaluate(() => {
      const attrs = [...document.querySelectorAll('[aria-label],[title]')].map((e) => e.getAttribute('aria-label') || e.getAttribute('title'));
      const metas = [...document.querySelectorAll('meta[content]')].filter((m) => /^(description|og:title|og:description)$/.test(m.name || m.getAttribute('property') || '')).map((m) => m.content);
      return document.title + '\n' + document.body.innerText + '\n' + attrs.join('\n') + '\n' + metas.join('\n');
    });
    await close();
    const js = [...text(join(dist, 'site.js')).matchAll(/(['`])((?:(?!\1)[^\\\n]|\\.){6,})\1/g)].map((m) => m[2]).filter((s) => /[A-Za-z]{3,} [A-Za-z]{2,}/.test(s) && !/[#.[\]=<>{}]/.test(s)).join('\n');
    const ref = refHashes();
    const shared = new Set();
    for (const b of bigrams(dom + '\n' + js)) if (!BIGRAM_ALLOW.has(b) && ref.has(hashOf(b))) shared.add(b);
    assert(!shared.size, `${shared.size} shared word pairs: ${[...shared].slice(0, 25).join(' | ')}`);
    return `${ref.size} reference pairs checked`;
  });

  await gate('G10', 'contract slot (absent): top, inert, always visible, no date', async () => {
    const { page, close } = await open(browser, base, { w: 390 });
    const info = await page.evaluate(() => {
      const s = document.querySelector('.ca-bar .ca');
      const r = s.getBoundingClientRect();
      return { tag: s.tagName, state: s.dataset.state, top: r.top, text: s.textContent.trim(), tab: s.getAttribute('tabindex'), btn: !!document.querySelector('button.ca'), insideHeader: !!s.closest('header.top') };
    });
    assert(info.tag === 'DIV' && info.state === 'absent' && !info.btn && info.tab === null, 'slot must be an inert div while absent');
    assert(info.insideHeader && info.top >= 0 && info.top < 12, 'slot is not at the very top: ' + info.top);
    assert(!/\b(19|20)\d\d\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\bsoon\b|\bq[1-4]\b|\btoday\b|\btomorrow\b/i.test(info.text), 'date-like text in slot: ' + info.text);
    await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
    await new Promise((r) => setTimeout(r, 150));
    const after = await page.evaluate(() => { const r = document.querySelector('.ca-bar .ca').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
    assert(after.top >= 0 && after.bottom > 20, 'slot left the viewport after scroll');
    await page.click('.ca-bar .ca').catch(() => {});
    assert(!(await page.evaluate(() => window.__copied.length)), 'inert slot copied something');
    await close();
  });

  await gate('G11', 'contract slot (stated): full address, click copies, stays pinned', async () => {
    const { page, close } = await open(browser, baseStated, { w: 360 });
    const shown = await page.$eval('.ca-addr', (e) => e.textContent);
    assert(shown === FIX_ADDR, 'address shortened or altered: ' + shown);
    const box = await page.$eval('button.ca', (e) => { const r = e.getBoundingClientRect(); return { h: r.height, w: r.width, vw: innerWidth }; });
    assert(box.h >= 48 && box.w <= box.vw, 'slot box ' + JSON.stringify(box));
    await page.click('button.ca');
    await page.waitForFunction(() => window.__copied.length === 1 && document.querySelector('button.ca').classList.contains('copied'));
    assert((await page.evaluate(() => window.__copied[0])) === FIX_ADDR, 'copied text differs');
    assert(await page.$eval('button.ca', (e) => e.classList.contains('copied')), 'no copied feedback');
    await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
    await new Promise((r) => setTimeout(r, 150));
    assert(await page.$eval('button.ca', (e) => e.getBoundingClientRect().top >= 0), 'slot not pinned');
    await close();
  });

  /* ===== layout at five widths ===== */
  const overflowProbe = () => {
    const vw = document.documentElement.clientWidth, bad = [];
    if (document.documentElement.scrollWidth > innerWidth) bad.push('document scrollWidth ' + document.documentElement.scrollWidth + ' > ' + innerWidth);
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (r.right > vw + 0.5 || r.left < -0.5) {
        let p = el.parentElement, clipped = false;
        while (p && p !== document.body) { if (getComputedStyle(p).overflowX !== 'visible') { clipped = true; break; } p = p.parentElement; }
        if (!clipped) bad.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className.baseVal ?? el.className).split(' ')[0]) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
      }
    }
    return bad.slice(0, 6);
  };
  await gate('G12', 'no horizontal overflow at 360/390/430/1366/1440 (live data loaded)', async () => {
    const report = [];
    for (const w of SIZES) {
      const { page, close } = await open(browser, base, { w });
      await liveReady(page);
      await page.evaluate(() => document.querySelectorAll('[data-reveal]').forEach((e) => e.classList.add('in')));
      const bad = await page.evaluate(overflowProbe);
      if (bad.length) report.push(w + 'px: ' + bad.join(', '));
      await close();
    }
    assert(!report.length, report.join('\n'));
    return SIZES.join('/') + ' ok';
  });

  await gate('G13', 'no overflow with a full address, open FAQ, open menu, offline data', async () => {
    const report = [];
    for (const w of SIZES) {
      const { page, close } = await open(browser, baseStated, { w, fx: { rpcStatus: 500, dexStatus: 500, llamaStatus: 500 } });
      await new Promise((r) => setTimeout(r, 250));
      await page.evaluate(() => { document.querySelectorAll('details').forEach((d) => (d.open = true)); document.querySelectorAll('[data-reveal]').forEach((e) => e.classList.add('in')); });
      if (w < 901) await page.click('.menu-btn');
      await new Promise((r) => setTimeout(r, 120));
      const bad = await page.evaluate(overflowProbe);
      if (bad.length) report.push(w + 'px: ' + bad.join(', '));
      await close();
    }
    assert(!report.length, report.join('\n'));
  });

  await gate('G14', 'tap targets: every link, button and summary is at least 48px both ways', async () => {
    const report = [];
    for (const w of SIZES) {
      const { page, close } = await open(browser, baseStated, { w });
      await liveReady(page);
      if (w < 901) { await page.click('.menu-btn'); await new Promise((r) => setTimeout(r, 400)); }
      const small = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('a[href], button, summary, [role="button"]')) {
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          if (r.width < 47.5 || r.height < 47.5) out.push((el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
        }
        return out;
      });
      if (small.length) report.push(w + 'px: ' + [...new Set(small)].slice(0, 5).join(', '));
      await close();
    }
    assert(!report.length, report.join('\n'));
  });

  /* ===== live data ===== */
  await gate('G15', 'live data: values, formats, pairs, trail, pill', async () => {
    const { page, close, errors, log } = await open(browser, base, {});
    await liveReady(page);
    await page.waitForFunction(() => document.querySelector('[data-live="block"]').textContent === '70,123,456');
    const v = await page.evaluate(() => ({
      tvl: document.querySelector('[data-live="tvl"]').textContent, gas: document.querySelector('[data-live="gas"]').textContent,
      vol: document.querySelector('[data-live="vol"]').textContent, rows: [...document.querySelectorAll('#pairs-body tr')].map((r) => r.querySelector('th').textContent.trim()),
      range: document.querySelector('[data-live="range"]').textContent, line: document.querySelector('#spark-line').getAttribute('d').length,
      pill: [...document.querySelectorAll('[data-pill]')].map((p) => p.dataset.state + '|' + p.textContent.trim()), dotAnim: getComputedStyle(document.querySelector('.pill-top .dot'), '::after').animationName,
      firstLink: document.querySelector('#pairs-body a').href, sparkBox: document.querySelector('#spark-svg').getBoundingClientRect().width, sparkDrawn: document.querySelector('#spark-svg').classList.contains('drawn'),
    }));
    assert(v.tvl === '$1.23B', 'tvl ' + v.tvl);
    assert(v.gas === '0.5000 gwei', 'gas ' + v.gas);
    const sum = PAIR_VOLUMES.reduce((a, b) => a + b, 0);
    assert(v.vol === '$' + (sum / 1e6).toFixed(2) + 'M', 'vol ' + v.vol);
    assert(v.rows.length === 6 && v.rows[0].startsWith('ETH/USDG'), 'pair rows ' + JSON.stringify(v.rows));
    assert(v.range === '30 days', 'range ' + v.range);
    assert(v.line > 100, 'trail not drawn');
    assert(v.sparkBox > 100 && v.sparkDrawn, 'trail svg not visible: ' + v.sparkBox + ' drawn=' + v.sparkDrawn);
    assert(v.pill.every((p) => p === 'live|Live · chain 4663'), 'pill ' + v.pill);
    assert(v.dotAnim === 'pulse', 'live dot not pulsing: ' + v.dotAnim);
    assert(v.firstLink.startsWith('https://dexscreener.com/'), 'row link ' + v.firstLink);
    assert(errors.length === 0, 'page errors: ' + errors.join('; '));
    assert(!log.some((l) => /defillama|dexscreener\.com\/latest/i.test(l)), 'unexpected endpoints');
    await close();
  });

  await gate('G16', 'skeletons: every live field and the trail wait behind a skeleton', async () => {
    let release;
    const hold = new Promise((r) => (release = r));
    const { page, close } = await open(browser, base, { fx: { hold } });
    await new Promise((r) => setTimeout(r, 200));
    const pending = await page.evaluate(() => {
      const live = [...document.querySelectorAll('[data-live]')].filter((e) => e.dataset.live !== 'pairs-note');
      return { total: live.length, withSkel: live.filter((e) => e.querySelector('.skel')).length, rows: document.querySelectorAll('#pairs-body [data-skel]').length, spark: !!document.querySelector('#spark-skel:not([hidden])'), pill: document.querySelector('[data-pill]').dataset.state };
    });
    assert(pending.total === 5 && pending.withSkel === 5, 'live fields without skeleton: ' + JSON.stringify(pending));
    assert(pending.rows >= 3 && pending.spark && pending.pill === 'connecting', 'table/trail/pill not in loading state: ' + JSON.stringify(pending));
    release();
    await liveReady(page);
    const after = await page.evaluate(() => [...document.querySelectorAll('.skel')].filter((e) => !e.closest('[hidden]')).length);
    assert(after === 0, after + ' skeletons left after load');
    await close();
  });

  await gate('G17', 'count-up flash fires when a live value changes', async () => {
    const { page, fx, close } = await open(browser, base, {});
    await liveReady(page);
    await page.waitForFunction(() => document.querySelector('[data-live="block"]').textContent === '70,123,456');
    assert((await page.$eval('[data-live="block"]', (e) => e.dataset.flashes || '0')) === '0', 'flash on first value');
    fx.block = 70123999; fx.gas = 650000000;
    await page.waitForFunction(() => document.querySelector('[data-live="block"]').textContent === '70,123,999' && document.querySelector('[data-live="gas"]').textContent === '0.6500 gwei', { timeout: 6000 });
    const f = await page.evaluate(() => ({ b: document.querySelector('[data-live="block"]').dataset.flashes, g: document.querySelector('[data-live="gas"]').dataset.flashes }));
    assert(Number(f.b) >= 1 && Number(f.g) >= 1, 'no flash on change ' + JSON.stringify(f));
    await close();
  });

  await gate('G18', 'source failures degrade per gauge, never throw', async () => {
    const { page, close, errors } = await open(browser, base, { fx: { rpcStatus: 500, dexStatus: 500, llamaStatus: 500 } });
    await page.waitForFunction(() => document.querySelector('[data-pill]').dataset.state === 'offline', { timeout: 6000 });
    await page.waitForFunction(() => document.querySelector('#pairs-body td[colspan]'), { timeout: 6000 });
    await page.waitForFunction(() => document.querySelector('#spark-skel').hidden, { timeout: 6000 });
    const v = await page.evaluate(() => ({ vals: [...document.querySelectorAll('[data-live="tvl"],[data-live="block"],[data-live="gas"],[data-live="vol"]')].map((e) => e.textContent + '|' + e.dataset.state), skel: [...document.querySelectorAll('.skel')].filter((e) => !e.closest('[hidden]')).length, range: document.querySelector('[data-live="range"]').textContent }));
    assert(v.vals.every((x) => x === '—|error'), 'gauges ' + v.vals);
    assert(v.skel === 0, v.skel + ' skeletons left');
    assert(/unavailable/i.test(v.range), 'trail note ' + v.range);
    assert(errors.length === 0, 'page errors: ' + errors.join('; '));
    await close();
  });

  await gate('G19', 'an endpoint answering as another chain id is refused', async () => {
    const { page, close } = await open(browser, base, { fx: { chainId: 1 } });
    await page.waitForFunction(() => document.querySelector('[data-pill]').dataset.state === 'wrong', { timeout: 6000 });
    const v = await page.evaluate(() => document.querySelector('[data-live="block"]').textContent);
    assert(v === '—', 'block shown from wrong chain: ' + v);
    await close();
  });

  await gate('G27', 'pair lookup: inert while absent, live when an address is stated', async () => {
    const a = await open(browser, base, {});
    await liveReady(a.page);
    const st = await a.page.evaluate(() => ({ s: document.querySelector('#lookup').dataset.state, vis: !!document.querySelector('.lookup-link:not([hidden])') }));
    assert(st.s === 'absent' && !st.vis, 'lookup active without an address');
    assert(!a.log.some((l) => /token-pairs\/v1\/robinhood\/0x(?!0{40}\b)/.test(l)), 'looked up an address that is not stated');
    await a.close();
    const b = await open(browser, baseStated, {});
    await b.page.waitForFunction(() => document.querySelector('#lookup').dataset.state === 'ok', { timeout: 6000 });
    const v = await b.page.evaluate(() => ({ pair: document.querySelector('[data-lk="pair"]').textContent, liq: document.querySelector('[data-lk="liq"]').textContent, chg: document.querySelector('[data-lk="change"]').textContent, href: document.querySelector('.lookup-link').href }));
    assert(v.pair === 'FIX/USDG' && v.liq === '$150.0K', 'best-liquidity pair not chosen: ' + JSON.stringify(v));
    assert(v.chg === '-0.80%' && v.href.startsWith('https://dexscreener.com/'), 'change/link ' + JSON.stringify(v));
    await b.close();
  });

  /* ===== motion ===== */
  await gate('G20', 'scroll progress bar tracks the page', async () => {
    const { page, close } = await open(browser, base, { w: 1366 });
    const frac = async (min = 0, max = 1) => { await page.waitForFunction((a, b) => { const f = document.querySelector('#progress-bar').getBoundingClientRect().width / innerWidth; return f >= a && f <= b; }, { timeout: 4000 }, min, max).catch(() => {}); return page.$eval('#progress-bar', (e) => e.getBoundingClientRect().width / innerWidth); };
    const top = await frac();
    await page.evaluate(() => scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) / 2, behavior: 'instant' }));
    const mid = await frac(0.4, 0.6);
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    const end = await frac(0.98, 1.01);
    assert(top < 0.02 && mid > 0.4 && mid < 0.6 && end > 0.98, `progress ${top.toFixed(2)} / ${mid.toFixed(2)} / ${end.toFixed(2)}`);
    await close();
  });

  await gate('G21', 'scroll reveal: starts hidden, shows on entry, entrances are staggered', async () => {
    const { page, close } = await open(browser, base, { w: 1366 });
    const sel = '.grid3 > div';
    const before = await page.$$eval(sel, (els) => els.map((e) => getComputedStyle(e).opacity));
    assert(before.every((o) => o === '0'), 'below-fold items visible too early ' + before);
    const delays = await page.$$eval(sel, (els) => els.map((e) => getComputedStyle(e).transitionDelay.split(',')[0]));
    assert(new Set(delays).size === delays.length, 'no stagger ' + delays);
    await page.$eval(sel, (e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForFunction((s) => [...document.querySelectorAll(s)].every((e) => getComputedStyle(e).opacity === '1'), { timeout: 4000 }, sel);
    await close();
  });

  await gate('G22', 'parallax: hero layers drift at different depths on scroll', async () => {
    const { page, close } = await open(browser, base, { w: 1366 });
    const ty = () => page.$$eval('.pad .layer', (g) => g.map((e) => { const m = getComputedStyle(e).transform; return m === 'none' ? 0 : parseFloat(m.split(',')[5]); }));
    const a = await ty();
    await page.evaluate(() => scrollTo({ top: 400, behavior: 'instant' }));
    await new Promise((r) => setTimeout(r, 150));
    const b = await ty();
    assert(a.every((n) => Math.abs(n) < 0.5), 'layers offset at rest ' + a);
    assert(b[0] > 3 && b[1] > b[0] && b[2] > b[1], 'layers do not separate: ' + b.map((n) => n.toFixed(1)));
    await close();
  });

  await gate('G23', 'prefers-reduced-motion: everything lands instantly', async () => {
    const { page, close } = await open(browser, base, { reduce: true, clock: 1 });
    const early = await page.evaluate(() => ({
      reveal: [...document.querySelectorAll('[data-reveal]')].every((e) => getComputedStyle(e).opacity === '1'),
      draw: getComputedStyle(document.querySelector('.pad .draw')).strokeDashoffset,
      blip: getComputedStyle(document.querySelector('.blip')).opacity,
    }));
    assert(early.reveal && early.blip === '1' && parseFloat(early.draw) === 0, 'content waits on motion ' + JSON.stringify(early));
    await liveReady(page);
    const snap = await page.evaluate(() => ({ block: document.querySelector('[data-live="block"]').textContent, anims: document.getAnimations().length, btn: getComputedStyle(document.querySelector('.button')).transitionDuration }));
    assert(snap.block === '70,123,456', 'count-up not instant: ' + snap.block);
    assert(snap.anims === 0, snap.anims + ' animations still running');
    assert(/^0s(, 0s)*$/.test(snap.btn), 'transitions active: ' + snap.btn);
    await page.evaluate(() => scrollTo({ top: 500, behavior: 'instant' }));
    await new Promise((r) => setTimeout(r, 120));
    const t = await page.$$eval('.pad .layer', (g) => g.map((e) => getComputedStyle(e).transform));
    assert(t.every((m) => m === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(m)), 'parallax still moves ' + t);
    await close();
  });

  await gate('G24', 'hover: every interactive element has a transition, and one really moves', async () => {
    const { page, close } = await open(browser, baseStated, { w: 1440 });
    const missing = await page.evaluate(() => [...document.querySelectorAll('a[href], button, summary')].filter((e) => !(e.className || '').toString().includes('is-inert')).filter((e) => {
      const d = getComputedStyle(e).transitionDuration.split(',').map((x) => parseFloat(x));
      return !d.some((n) => n > 0);
    }).map((e) => e.className || e.tagName).slice(0, 5));
    assert(!missing.length, 'no transition on: ' + missing.join(', '));
    const before = await page.$eval('.hero .button', (e) => getComputedStyle(e).transform);
    await page.hover('.hero .button');
    await new Promise((r) => setTimeout(r, 450));
    const after = await page.$eval('.hero .button', (e) => getComputedStyle(e).transform);
    assert(before !== after, 'hover changed nothing');
    await close();
  });

  /* ===== document ===== */
  await gate('G25', 'document: title, description, theme colours, icon, one h1', async () => {
    const { page, close } = await open(browser, base, {});
    const d = await page.evaluate(() => ({
      title: document.title, desc: document.querySelector('meta[name="description"]').content, lang: document.documentElement.lang,
      h1: document.querySelectorAll('h1').length, vp: !!document.querySelector('meta[name="viewport"]'), og: document.querySelectorAll('meta[property^="og:"]').length,
      themes: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content), icons: [...document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]')].map((l) => l.href), ogimg: (document.querySelector('meta[property="og:image"]') || {}).content, canon: document.querySelector('link[rel="canonical"]').href,
      imgsNoAlt: document.querySelectorAll('img:not([alt])').length,
    }));
    assert(d.title.length > 10 && d.title.length < 70, 'title ' + d.title);
    assert(d.desc.length > 60 && d.desc.length < 200, 'description length ' + d.desc.length);
    assert(d.lang === 'en' && d.h1 === 1 && d.vp && d.og >= 3 && d.imgsNoAlt === 0, 'basics ' + JSON.stringify(d));
    const tokens = text(join(ROOT, 'src/tokens.css'));
    assert(d.themes.length === 2 && d.themes.every((c) => tokens.includes(c)), 'theme-color not from tokens: ' + d.themes);
    assert(d.canon === 'https://heliport.ink/', 'canonical ' + d.canon);
    assert(d.icons.length === 3 && d.ogimg === 'https://heliport.ink/share-card.jpg', 'icons/og image ' + JSON.stringify([d.icons, d.ogimg]));
    for (const u of d.icons) {
      const sig = await page.evaluate(async (x) => [...new Uint8Array(await (await fetch(x)).arrayBuffer()).slice(0, 4)], u);
      assert(sig.join() === '137,80,78,71', 'icon is not a PNG: ' + u);
    }
    await close();
  });

  const inBrandBand = ([r, g, b]) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
  if (c <= 10) return true;
  let h = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
  h = (h * 60 + 360) % 360;
  return (h >= 185 && h <= 250) || (h >= 20 && h <= 70 && mn >= 200);
};
await gate('G26', 'both colour schemes: readable contrast, every painted colour stays in the brand blue / cream band', async () => {
    const seen = {};
    for (const scheme of ['light', 'dark']) {
      const { page, close } = await open(browser, baseStated, { scheme });
      await liveReady(page);
      await page.evaluate(() => document.querySelectorAll('[data-reveal]').forEach((e) => e.classList.add('in')));
      const out = await page.evaluate(() => {
        const colors = new Set();
        for (const el of document.querySelectorAll('body, body *')) {
          const cs = getComputedStyle(el);
          for (const p of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'outlineColor', 'fill', 'stroke']) { const v = cs[p]; if (v && v !== 'none') colors.add(v); }
        }
        const cs = getComputedStyle(document.body);
        return { colors: [...colors], bg: cs.backgroundColor, ink: cs.color, muted: getComputedStyle(document.querySelector('.fine')).color };
      });
      const bad = [];
      for (const c of out.colors) {
        const p = parseColor(c);
        if (!p) { if (!/^(none|currentcolor)$/i.test(c)) bad.push('unparsed ' + c); continue; }
        if (!inBrandBand(p)) bad.push(c);
      }
      assert(!bad.length, scheme + ' chromatic or unparsed: ' + bad.slice(0, 4).join(' | '));
      const bg = parseColor(out.bg), ink = parseColor(out.ink), muted = parseColor(out.muted);
      assert(contrast(ink, bg) >= 7 && contrast(muted, bg) >= 4.5, `${scheme} contrast ${contrast(ink, bg).toFixed(1)} / ${contrast(muted, bg).toFixed(1)}`);
      seen[scheme] = out.bg;
      await close();
    }
    assert(seen.light !== seen.dark, 'schemes render identically');
  });

  await gate('G29', 'brand assets: headers read, alpha handled premultiplied, icons built from the real mark', () => {
    const logo = join(ROOT, 'brand/LOGO HELIPORT PNG...png');
    const hd = readHeader(logo);
    assert(hd.format === 'png' && hd.colorType === 6 && hd.width === 2000, 'IHDR ' + JSON.stringify(hd));
    const st = alphaStats(decode(logo));
    assert(st.pureBlackTransparent > 1e6, 'expected the pure-black transparent region the palette comment describes');
    // synthetic: opaque white beside transparent pure black must stay white when averaged
    const syn = { width: 4, height: 1, data: new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]) };
    const pm = resizePremultiplied(syn, 1, 1);
    assert(pm.data[0] >= 254 && pm.data[1] >= 254 && pm.data[2] >= 254 && pm.data[3] >= 126 && pm.data[3] <= 129, 'premultiplied resize greyed the edge: ' + [...pm.data]);
    const naive = (255 + 255 + 0 + 0) / 4;
    assert(naive < 140, 'fixture would not expose straight-alpha bleed');
    const sizes = { 'favicon-32.png': 32, 'favicon-64.png': 64, 'apple-touch-icon.png': 180, 'brand-mark.png': 128 };
    for (const [f, n] of Object.entries(sizes)) {
      const p = join(ROOT, 'src/assets', f), h2 = readHeader(p);
      assert(h2.width === n && h2.height === n, f + ' size ' + h2.width + 'x' + h2.height);
      const im = decode(p);
      let blue = 0, cream = 0, dark = 0, opaque = 0;
      for (let i = 0; i < n * n; i++) {
        const [r, g, b, a] = [im.data[i * 4], im.data[i * 4 + 1], im.data[i * 4 + 2], im.data[i * 4 + 3]];
        if (a === 255) opaque++;
        if (a > 200 && r < 40 && g > 80 && b > 220) blue++;
        if (a > 200 && r > 225 && g > 220 && b > 205) cream++;
        if (a > 200 && r + g + b < 120) dark++;
      }
      assert(blue > n * n * 0.3 && cream > n * n * 0.04, f + ' lacks brand blue / cream: ' + blue + '/' + cream);
      assert(dark === 0, f + ' has ' + dark + ' near-black opaque pixels (transparent fill bled in)');
      if (f === 'apple-touch-icon.png') assert(opaque === n * n, 'touch icon must be fully opaque');
    }
    return 'icons 32/64/128/180 verified';
  });

  await gate('G28', 'budget: whole run finishes under five minutes', () => {
    const el = Date.now() - T0;
    assert(el < BUDGET_MS, `${(el / 1000).toFixed(0)}s`);
    return `${(el / 1000).toFixed(1)}s so far`;
  });

  await browser.close();
  srv.close(); srvStated.close();
}

main()
  .catch((e) => { console.error('gate runner crashed:', e); results.push({ id: 'RUN', ok: false }); })
  .finally(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} gates passed in ${((Date.now() - T0) / 1000).toFixed(1)}s`);
    if (results.length > 30) { console.log('too many gates (max 30)'); process.exit(1); }
    process.exit(failed.length ? 1 : 0);
  });
