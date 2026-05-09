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
    acquiredAt: now,
    balance: 0
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
  // Real-world semantics: settle the outstanding balance before closing the
  // account. Without this, players could escape interest accrual just by
  // cancelling, and we'd carry orphaned balances on cancelled cards.
  if ((inst.balance ?? 0) > 0) return { error: 'OUTSTANDING_BALANCE' };
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

// ---------- BALANCE: CHARGE / PAY / INTEREST ----------

// Add `amount` to a card's outstanding balance. Enforces the per-card credit
// limit (`minLine` from the catalog). Caller is responsible for the matching
// goods/services side of the transaction (granting shares, transferring
// property ownership, etc). Pure on the seat slice.
export function chargeCard(seat, instanceId, amount) {
  const inst = seat.creditCards.find((c) => c.id === instanceId && c.status === 'active');
  if (!inst) return { ok: false, error: 'NO_CARD' };
  const card = CARD_CATALOG[inst.cardId];
  if (!card) return { ok: false, error: 'UNKNOWN_CARD' };
  if (typeof amount !== 'number' || !(amount > 0)) return { ok: false, error: 'BAD_AMOUNT' };
  const limit = card.minLine ?? 0;
  const cur = inst.balance ?? 0;
  if (cur + amount > limit) {
    return { ok: false, error: 'INSUFFICIENT_CREDIT', limit, available: Math.max(0, limit - cur) };
  }
  inst.balance = Math.round((cur + amount) * 100) / 100;
  return { ok: true, charged: amount, balance: inst.balance, limit };
}

// Pay down a card balance with cash. Caps at the outstanding balance (no
// negative balances / over-payment). Allows paying cancelled cards too so
// players can clean up residual balance after closure.
export function payCardBalance(seat, instanceId, amount) {
  const inst = seat.creditCards.find((c) => c.id === instanceId);
  if (!inst) return { ok: false, error: 'NO_CARD' };
  if (typeof amount !== 'number' || !(amount > 0)) return { ok: false, error: 'BAD_AMOUNT' };
  const cur = inst.balance ?? 0;
  if (cur <= 0) return { ok: false, error: 'NO_BALANCE' };
  const pay = Math.min(amount, cur);
  if (seat.cash < pay) return { ok: false, error: 'INSUFFICIENT_FUNDS' };
  seat.cash = Math.round((seat.cash - pay) * 100) / 100;
  inst.balance = Math.round((cur - pay) * 100) / 100;
  return { ok: true, paid: pay, balance: inst.balance };
}

// Accrue interest on every active card with an outstanding balance. Anchored
// to `state.stocks.cycle` (the existing 4-turn counter that drives auto-flips
// and HYSA), so interest hits on the same boundary regardless of turn order.
// Caller passes the current cycle and is expected to invoke this only on the
// 4-turn boundary; we double-check with `cycle % 4 === 0` defensively.
export function accrueCardInterest(seats, cycle) {
  const events = [];
  if (!Array.isArray(seats)) return events;
  if (typeof cycle !== 'number' || cycle <= 0 || cycle % 4 !== 0) return events;
  for (const seat of seats) {
    if (!Array.isArray(seat?.creditCards)) continue;
    for (const inst of seat.creditCards) {
      if (inst.status !== 'active') continue;
      const cur = inst.balance ?? 0;
      if (cur <= 0) continue;
      const card = CARD_CATALOG[inst.cardId];
      if (!card) continue;
      const rate = card.interestRate ?? 0;
      if (rate <= 0) continue;
      const interest = Math.round(cur * rate * 100) / 100;
      if (interest <= 0) continue;
      inst.balance = Math.round((cur + interest) * 100) / 100;
      events.push({
        seatIndex: seat.seat,
        instanceId: inst.id,
        cardId: inst.cardId,
        rate,
        interest,
        balance: inst.balance
      });
    }
  }
  return events;
}
