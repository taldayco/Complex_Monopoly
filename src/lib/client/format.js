// Number formatters shared across all components. Replaces the per-file
// `function fmt(v) {…}` copies that lived in 12 components.
//
// Pick the variant that matches the context:
//   fmtCash     — cash amounts; trailing zeros suppressed ($1,500 not $1,500.00).
//   fmtPrice    — stock/asset prices; always two decimals ($50.00).
//   fmtRate     — interest/yield rates expressed as decimals (0.05 → "5.00%").
//   fmtPctDelta — signed price-move pcts already in percent units (5 → "+5.0%").

const DASH = '—';

export function fmtCash(v) {
  if (typeof v !== 'number') return DASH;
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function fmtPrice(v) {
  if (typeof v !== 'number') return DASH;
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtRate(p) {
  if (typeof p !== 'number') return DASH;
  return (p * 100).toFixed(2) + '%';
}

export function fmtPctDelta(p) {
  if (typeof p == null || typeof p !== 'number') return DASH;
  return (p > 0 ? '+' : '') + p.toFixed(1) + '%';
}

// Returns 'up' / 'down' / '' for stylistic class binding on price moves.
export function pctClass(p) {
  if (typeof p !== 'number' || p === 0) return '';
  return p > 0 ? 'up' : 'down';
}
