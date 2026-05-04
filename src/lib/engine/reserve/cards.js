// Engine-side credit-card helpers. Each function mutates the seat slice it
// is given; callers (the reducer) work on a structuredClone of the room.

import {
  CARD_CATALOG,
  getCard,
  meetsTierRequirement
} from '../../shared/reserve/cardCatalog.js';

let CARD_ID_COUNTER = 0;
function genInstanceId(seat, cardId) {
  CARD_ID_COUNTER += 1;
  return `CC-${seat.seat}-${cardId}-${CARD_ID_COUNTER}`;
}

// ---------- APPLY ----------

export function applyForCard(seat, cardId, now = Date.now()) {
  const card = getCard(cardId);
  if (!card) return { error: 'UNKNOWN_CARD' };

  // No duplicates — one active instance per card.
  const alreadyHas = seat.creditCards.some(
    (c) => c.cardId === cardId && c.status === 'active'
  );
  if (alreadyHas) return { error: 'ALREADY_OWNED' };

  if (!meetsTierRequirement(seat, card.requiredTier)) {
    return { error: 'TIER_TOO_LOW' };
  }
  if (seat.cash < card.signingFee) return { error: 'INSUFFICIENT_FUNDS' };

  seat.cash = Math.round((seat.cash - card.signingFee + (card.signupBonus ?? 0)) * 100) / 100;
  const instance = {
    id: genInstanceId(seat, cardId),
    cardId,
    status: 'active',
    acquiredAt: now
  };
  seat.creditCards.push(instance);
  return { ok: true, card: instance, signingFee: card.signingFee, signupBonus: card.signupBonus ?? 0 };
}

// ---------- CANCEL ----------

export function cancelCard(seat, instanceId) {
  const idx = seat.creditCards.findIndex(
    (c) => c.id === instanceId && c.status === 'active'
  );
  if (idx === -1) return { error: 'NO_CARD' };
  const inst = seat.creditCards[idx];
  const card = getCard(inst.cardId);
  if (!card) return { error: 'UNKNOWN_CARD' };
  if (seat.cash < card.cancelFee) return { error: 'INSUFFICIENT_FUNDS' };
  seat.cash = Math.round((seat.cash - card.cancelFee) * 100) / 100;
  inst.status = 'cancelled';
  inst.cancelledAt = Date.now();
  return { ok: true, cancelFee: card.cancelFee };
}

// ---------- PER-TURN ROTATING FEES ----------

// Called at the start of each seat's turn. Charges every active card's
// rotating fee. If the seat can't afford a card's fee, that card auto-cancels
// (no cancel-fee charged — the card was already in default).
//
// Returns an array of { cardId, fee, action: 'charged' | 'autoCancelled' }
// so the reducer can log structured events.
export function applyTurnStartCardFees(seat) {
  const events = [];
  for (const inst of seat.creditCards) {
    if (inst.status !== 'active') continue;
    const card = CARD_CATALOG[inst.cardId];
    if (!card) continue;
    const fee = card.rotatingFee ?? 0;
    if (fee <= 0) continue;
    if (seat.cash >= fee) {
      seat.cash = Math.round((seat.cash - fee) * 100) / 100;
      events.push({ cardId: inst.cardId, fee, action: 'charged' });
    } else {
      inst.status = 'cancelled';
      inst.cancelledAt = Date.now();
      inst.cancelReason = 'unpaidFee';
      events.push({ cardId: inst.cardId, fee, action: 'autoCancelled' });
    }
  }
  return events;
}
