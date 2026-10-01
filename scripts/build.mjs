// Static build: src/ + registry -> dist/. No dependencies.
// Usage: node scripts/build.mjs [--registry file.js] [--out dir]
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateRegistry, deriveHandle, isLive, esc, STATES } from '../src/register.js';
import { CADENCE, DEX_CHAIN, NATIVE, LLAMA_NAME } from '../src/config.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

const readTokens = () => {
  const css = readFileSync(join(SRC, 'tokens.css'), 'utf8');
  const light = css.match(/:root\s*{([^}]*)}/)[1];
  const dark = css.match(/:root\[data-theme="dark"\]\s*{([^}]*)}/)[1];
  const pick = (block, name) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))[1];
  return { light: { bg: pick(light, 'bg'), ink: pick(light, 'ink') }, dark: { bg: pick(dark, 'bg'), ink: pick(dark, 'ink') } };
};

const caSlot = (rec) => {
  const label = '<span class="ca-label">Contract</span>';
  if (rec.state === 'stated') {
    const a = esc(rec.value);
    return `<button class="ca" type="button" data-state="stated" data-copy="${a}" aria-label="Copy contract address">${label}<span class="ca-addr">${a}</span><span class="ca-act"><svg class="i-copy" width="16" height="16" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i-check" width="16" height="16" aria-hidden="true"><use href="#i-check"/></svg><span class="ca-act-text">Copy</span></span></button><span class="sr" id="ca-status" role="status"></span>`;
  }
  if (rec.state === 'unconfirmed') {
    return `<div class="ca" data-state="unconfirmed">${label}<span class="ca-addr">${esc(rec.value)}</span><span class="ca-act">Unconfirmed</span></div>`;
  }
  return `<div class="ca" data-state="absent">${label}<span class="ca-addr ca-empty">No address stated</span></div>`;
};

const social = (rec, icon, name) => {
  if (isLive(rec) && rec.url) {
    const h = deriveHandle(rec.url);
    return `<a class="social" href="${esc(rec.url)}" target="_blank" rel="noopener" aria-label="Heliport on ${name}${h ? ', ' + esc(h) : ''}"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${icon}"/></svg></a>`;
  }
  return `<span class="social is-inert" role="img" aria-label="${name} account not stated yet" data-state="${rec.state}"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${icon}"/></svg></span>`;
};

const handleText = (rec) => {
  const h = rec.url ? deriveHandle(rec.url) : null;
  return h ? '@' + h : null;
};

const status = (rec, render) => {
  const g = `<i class="g g-${rec.state}" aria-hidden="true"></i>`;
  if (rec.state === 'stated') return `<td><span class="st">${g}<span>${render(rec)}</span></span></td>`;
  if (rec.state === 'unconfirmed') return `<td><span class="st">${g}<span>Unconfirmed${rec.value ? ': ' + esc(rec.value) : ''}</span></span></td>`;
  return `<td class="st-absent"><span class="st">${g}<span>Not stated</span></span></td>`;
};

const link = (rec, text) => (rec.url ? `<a class="cell-link" href="${esc(rec.url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));

const registerRows = (r) => [
  ['Contract address', status(r.ca, (x) => `<span class="mono">${esc(x.value)}</span>`)],
  ['Token symbol', status(r.ticker, (x) => esc(x.value))],
  ['X account', status(r.x, (x) => link(x, handleText(x) || x.url))],
  ['GitHub', status(r.github, (x) => link(x, handleText(x) || x.url))],
  ['Wallet app', status(r.app, (x) => link(x, new URL(x.url).host))],
  ['Chain id', status(r.chain, (x) => esc(x.value))],
  ['RPC endpoint', status(r.rpc, (x) => esc(new URL(x.value).host))],
  ['Domain', status(r.domain, (x) => esc(x.value))],
  ['Locked-value source', status(r.srcLlama, (x) => link(x, x.value))],
  ['Markets source', status(r.srcDex, (x) => link(x, x.value))],
].map(([k, cell]) => `          <tr><th scope="row">${k}</th>${cell}</tr>`).join('\n');

const footerLinks = (r) => {
  const li = (rec, name) => {
    if (isLive(rec) && rec.url) return `<li><a href="${esc(rec.url)}" target="_blank" rel="noopener">${name} ${esc(handleText(rec) || '')}</a></li>`;
    return `<li><span class="is-inert">${name}: not stated</span></li>`;
  };
  return [
    isLive(r.app) && r.app.url ? `<li><a href="${esc(r.app.url)}" target="_blank" rel="noopener">Wallet app</a></li>` : '<li><span class="is-inert">Wallet app: not stated</span></li>',
    li(r.x, 'X'),
    li(r.github, 'GitHub'),
    `<li><a href="${esc(r.srcLlama.url)}" target="_blank" rel="noopener">${esc(r.srcLlama.value)}</a></li>`,
    `<li><a href="${esc(r.srcDex.url)}" target="_blank" rel="noopener">${esc(r.srcDex.value)}</a></li>`,
  ].join('');
};

export async function build({ registryPath, out = join(ROOT, 'dist') } = {}) {
  const mod = registryPath ? await import(pathToFileURL(resolve(registryPath)).href) : await import(pathToFileURL(join(SRC, 'registry.js')).href);
  const reg = mod.REGISTRY;
  const errors = validateRegistry(reg);
  for (const k of Object.keys(reg)) if (!STATES.includes(reg[k].state)) errors.push(`${k}: unknown state`);
  if (errors.length) throw new Error('registry invalid:\n  ' + errors.join('\n  '));

  const tokens = readTokens();
  const caLive = isLive(reg.ca);
  const slots = {
    theme_light: tokens.light.bg,
    theme_dark: tokens.dark.bg,
    site_url: reg.domain.url,
    body_attrs: ` data-ca-state="${reg.ca.state}"`,
    ca_slot: caSlot(reg.ca),
    socials: social(reg.x, 'i-x', 'X') + social(reg.github, 'i-gh', 'GitHub'),
    register_rows: registerRows(reg),
    lookup_state: caLive ? 'stated' : 'absent',
    lookup_idle: caLive ? 'Looking up pairs for the stated address.' : 'Waiting for an address to be stated.',
    tvl_min: String(CADENCE.tvl / 60),
    rpc_sec: String(CADENCE.rpc),
    pairs_sec: String(CADENCE.pairs),
    footer_contracts: reg.ca.state === 'absent' ? '<li class="fine">Nothing stated yet.</li>' : `<li>${esc(reg.ca.value)}${reg.ca.state === 'unconfirmed' ? ' (unconfirmed)' : ''}</li>`,
    footer_links: footerLinks(reg),
    config_json: JSON.stringify({
      chain: reg.chain.value,
      rpc: reg.rpc.value,
      ca: caLive ? reg.ca.value : null,
      cadence: CADENCE,
      dexChain: DEX_CHAIN,
      native: NATIVE,
      llamaName: LLAMA_NAME,
    }).replace(/</g, '\\u003c'),
  };

  let html = readFileSync(join(SRC, 'index.template.html'), 'utf8');
  html = html.replace(/{{(\w+)}}/g, (m, k) => {
    if (!(k in slots)) throw new Error('unknown template slot ' + k);
    return slots[k];
  });
  if (/{{|}}/.test(html)) throw new Error('unresolved template slot');

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'index.html'), html);
  writeFileSync(join(out, 'site.css'), readFileSync(join(SRC, 'tokens.css'), 'utf8') + '\n' + readFileSync(join(SRC, 'site.css'), 'utf8'));
  writeFileSync(join(out, 'site.js'), readFileSync(join(SRC, 'site.js'), 'utf8'));
  const assets = readdirSync(join(SRC, 'assets')).filter((f) => f !== 'PROVENANCE.txt');
  for (const f of assets) copyFileSync(join(SRC, 'assets', f), join(out, f));
  return { out, files: ['index.html', 'site.css', 'site.js', ...assets] };
}

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build({ registryPath: arg('--registry'), out: arg('--out') ? resolve(arg('--out')) : undefined })
    .then((r) => console.log('built', r.files.join(', '), '->', r.out))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
