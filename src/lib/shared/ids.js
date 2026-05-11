// Per-instance unique ids that are durable across worker restarts.
//
// Module-level integer counters previously powered ID generation in mortgage.js,
// loans.js, cards.js, transfers.js, and eventCards.js. Those reset to 0 on
// every worker reload while persisted state still held IDs derived from the old
// counter — collisions on the first new write after restart. Replaced by a
// random 12-hex-char suffix per id (96 bits of entropy; collision-free for any
// realistic game volume).

function randomSuffix() {
  // crypto.randomUUID is available in both Node 16+ and the Cloudflare Workers
  // runtime. Strip the dashes and take the first 12 hex chars (~48 bits) for
  // a compact, readable suffix that still won't collide.
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

export function makeId(prefix) {
  return `${prefix}-${randomSuffix()}`;
}

// Specific helpers — the prefix is part of the engine's logging/debug
// vocabulary, keeping the helpers explicit makes call sites grep-friendly.
export const newLoanId = (seat) => `L-${seat.seat}-${randomSuffix()}`;
export const newMortgageLoanId = (seat) => `M-${seat.seat}-${randomSuffix()}`;
export const newCreditCardId = (seat, cardId) => `CC-${seat.seat}-${cardId}-${randomSuffix()}`;
export const newTransferId = () => `TR-${randomSuffix()}`;
export const newTempEffectId = (seat) => `TE-${seat.seat}-${randomSuffix()}`;
