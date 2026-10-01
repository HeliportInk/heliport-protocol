(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const cfg = JSON.parse($('#heli-config').textContent);

  // Motion budget. Reduced motion collapses every duration to zero; the test clock shrinks the rest.
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const clock = () => (typeof window.__HELI_CLOCK === 'number' ? window.__HELI_CLOCK : 1);
  const still = () => mq.matches;
  const ms = (n) => (still() ? 0 : n * clock());
  const every = (s) => s * 1000 * clock();

  /* ---------- reveal, progress, parallax ---------- */
  const revealAll = () => {
    const els = $$('[data-reveal]');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach((e) => io.observe(e));
  };

  const bar = $('.progress');
  const layers = $$('.pad .layer');
  let queued = false;
  const frame = () => {
    queued = false;
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.setProperty('--p', max > 0 ? Math.min(1, Math.max(0, y / max)).toFixed(4) : '0');
    for (const l of layers) l.style.setProperty('--py', still() ? '0' : (Math.min(y, 900) * Number(l.dataset.depth)).toFixed(2));
  };
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(frame); } };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });

  const head = $('#top');
  const syncHead = () => document.documentElement.style.setProperty('--head-h', head.offsetHeight + 8 + 'px');
  if ('ResizeObserver' in window) new ResizeObserver(syncHead).observe(head);
  syncHead();

  /* ---------- menu ---------- */
  const menuBtn = $('.menu-btn');
  const menu = $('#menu');
  const setMenu = (open) => { menuBtn.setAttribute('aria-expanded', String(open)); menu.classList.toggle('open', open); };
  menuBtn.addEventListener('click', () => setMenu(menuBtn.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  /* ---------- contract slot ---------- */
  const caBtn = $('button.ca');
  if (caBtn) {
    const status = $('#ca-status');
    let timer = 0;
    const done = () => {
      caBtn.classList.add('copied');
      const t = $('.ca-act-text', caBtn);
      if (t) t.textContent = 'Copied';
      if (status) status.textContent = 'Contract address copied';
      clearTimeout(timer);
      timer = setTimeout(() => {
        caBtn.classList.remove('copied');
        if (t) t.textContent = 'Copy';
        if (status) status.textContent = '';
      }, 1600);
    };
    caBtn.addEventListener('click', async () => {
      const text = caBtn.dataset.copy;
      try { await navigator.clipboard.writeText(text); }
      catch {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch { /* nothing else to try */ }
        ta.remove();
      }
      done();
    });
  }

  /* ---------- formatting ---------- */
  const int = (n) => Math.round(n).toLocaleString('en-US');
  const usd = (n) => {
    const a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(0);
  };
  const gwei = (n) => n.toFixed(n < 1 ? 4 : 2) + ' gwei';
  const price = (s) => {
    const n = Number(s);
    if (!isFinite(n)) return '—';
    if (n >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return '$' + n.toPrecision(3);
  };
  const change = (n) => (typeof n === 'number' ? (n > 0 ? '+' : '') + n.toFixed(2) + '%' : '—');

  /* ---------- live values: count-up and flash ---------- */
  const flash = (el) => {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    el.dataset.flashes = String(Number(el.dataset.flashes || 0) + 1);
    clearTimeout(el.__ft);
    el.__ft = setTimeout(() => el.classList.remove('flash'), Math.max(ms(900), 20));
  };
  const setLive = (key, v, fmt) => {
    const el = $(`[data-live="${key}"]`);
    if (!el) return;
    const prev = el.__v;
    el.dataset.state = 'ok';
    if (prev === v) { if ($('.skel', el)) el.textContent = fmt(v); return; }
    el.__v = v;
    cancelAnimationFrame(el.__raf);
    const dur = ms(prev == null ? 1100 : 650);
    if (dur <= 0) { el.textContent = fmt(v); return; }
    const from = prev == null ? 0 : prev;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = fmt(from + (v - from) * (1 - Math.pow(1 - k, 4)));
      if (k < 1) el.__raf = requestAnimationFrame(step); else el.textContent = fmt(v);
    };
    el.__raf = requestAnimationFrame(step);
    if (prev != null) flash(el);
  };
  const setError = (key) => {
    const el = $(`[data-live="${key}"]`);
    if (!el || el.__v != null) return;
    el.textContent = '—';
    el.dataset.state = 'error';
  };

  /* ---------- network ---------- */
  const getJson = async (url, init) => {
    const ctl = new AbortController();
    const id = setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetch(url, { ...init, signal: ctl.signal });
      if (!r.ok) throw new Error('http ' + r.status);
      return await r.json();
    } finally { clearTimeout(id); }
  };
  const loop = (fn, seconds) => {
    const run = async () => {
      if (!document.hidden) { try { await fn(); } catch { /* each source reports its own failure */ } }
      setTimeout(run, every(seconds));
    };
    run();
  };

  /* ---------- status pill ---------- */
  const PILL = { connecting: 'Tuning in', live: 'Live · chain ' + cfg.chain, offline: 'Chain endpoint offline', wrong: 'Unexpected chain id' };
  const setPill = (state) => {
    for (const p of $$('[data-pill]')) {
      p.dataset.state = state;
      $('.pill-text', p).textContent = PILL[state];
    }
  };

  /* ---------- chain RPC ---------- */
  const rpcCall = [
    { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
    { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] },
    { jsonrpc: '2.0', id: 3, method: 'eth_gasPrice', params: [] },
  ];
  const pollRpc = async () => {
    try {
      const res = await getJson(cfg.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rpcCall) });
      if (!Array.isArray(res)) throw new Error('shape');
      const by = {};
      for (const r of res) { if (r.error) throw new Error('rpc'); by[r.id] = r.result; }
      if (parseInt(by[1], 16) !== cfg.chain) { setPill('wrong'); setError('block'); setError('gas'); return; }
      setLive('block', parseInt(by[2], 16), int);
      setLive('gas', Number(BigInt(by[3])) / 1e9, gwei);
      setPill('live');
    } catch {
      setPill('offline');
      setError('block'); setError('gas');
    }
  };

  /* ---------- TVL and trail ---------- */
  const spark = { box: $('#spark'), svg: $('#spark-svg'), skel: $('#spark-skel'), line: $('#spark-line'), area: $('#spark-area'), cursor: $('#spark-cursor'), tip: $('#spark-tip'), data: null };
  const W = 600, H = 220, PAD = 14;
  const drawSpark = (series) => {
    const s = series.filter((p) => p.tvl > 0);
    if (s.length < 2) return sparkFail();
    const vals = s.map((p) => p.tvl);
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const pts = s.map((p, i) => [(i / (s.length - 1)) * W, H - PAD - ((p.tvl - lo) / span) * (H - PAD * 2)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    spark.line.setAttribute('d', d);
    spark.area.setAttribute('d', d + `L${W} ${H}L0 ${H}Z`);
    spark.data = s;
    const wasHidden = spark.svg.hasAttribute('hidden');
    spark.svg.removeAttribute('hidden');
    spark.skel.hidden = true;
    if (wasHidden) {
      if (still()) spark.svg.classList.add('drawn');
      else requestAnimationFrame(() => requestAnimationFrame(() => spark.svg.classList.add('drawn')));
    }
    const r = $('[data-live="range"]');
    r.textContent = s.length + ' days';
    r.dataset.state = 'ok';
    spark.box.setAttribute('aria-label', `Robinhood Chain locked value over ${s.length} days, latest ${usd(vals[vals.length - 1])}`);
  };
  const sparkFail = () => {
    if (spark.data) return;
    spark.skel.hidden = true;
    const r = $('[data-live="range"]');
    r.textContent = 'trail unavailable';
    r.dataset.state = 'error';
  };
  const sparkMove = (e) => {
    if (!spark.data) return;
    const rect = spark.box.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const p = spark.data[Math.round(f * (spark.data.length - 1))];
    const x = (Math.round(f * (spark.data.length - 1)) / (spark.data.length - 1)) * rect.width;
    spark.cursor.setAttribute('x1', (x / rect.width) * W);
    spark.cursor.setAttribute('x2', (x / rect.width) * W);
    spark.cursor.removeAttribute('hidden');
    spark.tip.hidden = false;
    spark.tip.textContent = new Date(p.date * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + ' · ' + usd(p.tvl);
    const half = spark.tip.offsetWidth / 2;
    spark.tip.style.left = Math.min(rect.width - half, Math.max(half, x)) + 'px';
  };
  spark.box.addEventListener('pointermove', sparkMove);
  spark.box.addEventListener('pointerdown', sparkMove);
  spark.box.addEventListener('pointerleave', () => { spark.tip.hidden = true; spark.cursor.setAttribute('hidden', ''); });

  const pollTvl = async () => {
    const [a, b] = await Promise.allSettled([
      getJson('https://api.llama.fi/v2/chains'),
      getJson('https://api.llama.fi/v2/historicalChainTvl/' + encodeURIComponent(cfg.llamaName)),
    ]);
    let current = null;
    const series = b.status === 'fulfilled' && Array.isArray(b.value) ? b.value : null;
    if (a.status === 'fulfilled' && Array.isArray(a.value)) {
      const c = a.value.find((x) => x && x.chainId === cfg.chain);
      if (c && typeof c.tvl === 'number') current = c.tvl;
    }
    if (current == null && series && series.length) current = series[series.length - 1].tvl;
    if (current != null) setLive('tvl', current, usd); else setError('tvl');
    if (series) drawSpark(series); else sparkFail();
  };

  /* ---------- pairs ---------- */
  const body = $('#pairs-body');
  const note = $('#pairs-note');
  const cell = (tag, label, text, cls) => {
    const c = document.createElement(tag);
    if (label) c.dataset.label = label;
    if (cls) c.className = cls;
    c.textContent = text;
    return c;
  };
  const safeUrl = (u) => (typeof u === 'string' && u.startsWith('https://dexscreener.com/') ? u : null);
  const renderPairs = (rows) => {
    body.textContent = '';
    for (const p of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      const href = safeUrl(p.url);
      const a = document.createElement(href ? 'a' : 'span');
      a.className = 'pair-link';
      if (href) { a.href = href; a.target = '_blank'; a.rel = 'noopener'; }
      a.append(document.createTextNode(`${p.baseToken.symbol}/${p.quoteToken.symbol}`));
      const small = document.createElement('small');
      small.textContent = [p.dexId, ...(p.labels || [])].join(' ');
      a.append(small);
      th.append(a);
      const ch = p.priceChange && typeof p.priceChange.h24 === 'number' ? p.priceChange.h24 : null;
      tr.append(
        th,
        cell('td', 'Price', price(p.priceUsd)),
        cell('td', '24h', change(ch), ch == null ? '' : ch >= 0 ? 'chg-up' : 'chg-down'),
        cell('td', 'Liquidity', p.liquidity ? usd(p.liquidity.usd) : '—'),
        cell('td', 'Volume', usd(p.volume.h24)),
      );
      body.append(tr);
    }
  };
  const pairsNotice = (text) => {
    body.textContent = '';
    const tr = document.createElement('tr');
    const td = cell('td', '', text);
    td.colSpan = 5;
    tr.append(td);
    body.append(tr);
  };
  const pollPairs = async () => {
    try {
      const list = await getJson(`https://api.dexscreener.com/token-pairs/v1/${cfg.dexChain}/${cfg.native}`);
      if (!Array.isArray(list)) throw new Error('shape');
      const rows = list
        .filter((p) => p && p.chainId === cfg.dexChain && p.baseToken && p.quoteToken && p.volume && typeof p.volume.h24 === 'number')
        .sort((a, b) => b.volume.h24 - a.volume.h24);
      if (!rows.length) { pairsNotice('No ETH pairs indexed right now.'); note.textContent = ''; setError('vol'); return; }
      renderPairs(rows.slice(0, 6));
      note.textContent = `Top ${Math.min(6, rows.length)} of ${rows.length} indexed pairs. Volume tile sums all ${rows.length}.`;
      setLive('vol', rows.reduce((n, p) => n + p.volume.h24, 0), usd);
    } catch {
      if ($('[data-skel]', body) || !body.children.length) pairsNotice('Pair data is unavailable right now. Retrying.');
      note.textContent = '';
      setError('vol');
    }
  };

  /* ---------- contract lookup (only when an address is stated) ---------- */
  const lookup = $('#lookup');
  const lk = (k) => $(`[data-lk="${k}"]`, lookup);
  const pollLookup = async () => {
    const idle = $('.lookup-idle', lookup), data = $('.lookup-data', lookup), link = $('.lookup-link', lookup);
    try {
      const list = await getJson(`https://api.dexscreener.com/token-pairs/v1/${cfg.dexChain}/${cfg.ca}`);
      const best = (Array.isArray(list) ? list : []).filter((p) => p && p.baseToken && p.quoteToken).sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0))[0];
      if (!best) { lookup.dataset.state = 'empty'; idle.textContent = 'No pair is indexed for this address yet.'; idle.hidden = false; data.hidden = true; link.hidden = true; return; }
      lookup.dataset.state = 'ok';
      lk('pair').textContent = `${best.baseToken.symbol}/${best.quoteToken.symbol}`;
      lk('price').textContent = price(best.priceUsd);
      lk('change').textContent = change(best.priceChange && best.priceChange.h24);
      lk('liq').textContent = best.liquidity ? usd(best.liquidity.usd) : '—';
      lk('vol').textContent = best.volume ? usd(best.volume.h24) : '—';
      const href = safeUrl(best.url);
      link.hidden = !href;
      if (href) link.href = href;
      idle.hidden = true; data.hidden = false;
    } catch {
      lookup.dataset.state = 'error';
      idle.textContent = 'Lookup is unavailable right now. Retrying.';
      idle.hidden = false; data.hidden = true; link.hidden = true;
    }
  };

  /* ---------- go ---------- */
  revealAll();
  frame();
  requestAnimationFrame(() => $('.pad').classList.add('in'));
  loop(pollRpc, cfg.cadence.rpc);
  loop(pollTvl, cfg.cadence.tvl);
  loop(pollPairs, cfg.cadence.pairs);
  if (cfg.ca) loop(pollLookup, cfg.cadence.pairs);
})();
