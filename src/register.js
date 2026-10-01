// Register pattern: every external fact is one record with a state.
//   stated      value is known and may be linked, copied or displayed as fact
//   absent      nothing is claimed; nothing is rendered as a link or an action
//   unconfirmed a value exists but nobody has verified it; shown, never linked
// Link rule: records store a URL; the handle shown to people is derived from it.

export const STATES = Object.freeze(['stated', 'absent', 'unconfirmed']);

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH32 = /^0x[0-9a-fA-F]{64}$/;

// Classify by shape. Hex strings are legitimate data (addresses, hashes);
// nothing here rejects "0x" as such, only values that claim a shape they lack.
export function classifyHex(v) {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]*$/.test(v)) return 'other';
  if (ADDRESS.test(v)) return 'address';
  if (HASH32.test(v)) return 'hash32';
  return 'hex';
}

export const isAddress = (v) => ADDRESS.test(String(v));

export function deriveHandle(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg ? seg : null;
  } catch {
    return null;
  }
}

export function isLive(rec) {
  return !!rec && rec.state === 'stated';
}

export function validateRegistry(reg) {
  const errors = [];
  for (const [key, rec] of Object.entries(reg)) {
    if (!rec || typeof rec !== 'object') { errors.push(`${key}: record missing`); continue; }
    if (!STATES.includes(rec.state)) errors.push(`${key}: bad state "${rec.state}"`);
    if (rec.state === 'stated' && rec.value == null && !rec.url) errors.push(`${key}: stated without value or url`);
    if (rec.state === 'absent' && (rec.value != null || rec.url != null)) errors.push(`${key}: absent record carries data`);
    if (rec.url != null) {
      try { new URL(rec.url); } catch { errors.push(`${key}: url is not a URL`); }
    }
  }
  const ca = reg.ca;
  if (ca && ca.state !== 'absent' && !isAddress(ca.value)) errors.push('ca: value is not a 20-byte hex address');
  return errors;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
