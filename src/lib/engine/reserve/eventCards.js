// Reserve event-card engine. Handles deck setup/hydration, drawing, effect
// resolution, and temp-effect decay. Effect handlers mutate the seat or the
// shared room slice they are given; the reducer wraps everything in a clone.

import {
  RESERVE_DECKS,
  getEventCard
} from '../../shared/reserve/eventCardCatalog.js';
import {
  STOCK_CATALOG,
  VOLATILE_STOCK_ORDER,
  FP500_SYMBOL
} from '../../shared/reserve/stockCatalog.js';
import { recalcFP500 } from './stocks.js';

let EFFECT_ID_COUNTER = 0;

// ---------- DECK SETUP ----------

// Deterministic Fisher-Yates shuffle (LCG-driven so we don't need to inject
// the rng module here). Mirrors the style used for the existing chance/
// community-chest decks in createGame.js.
function shuffleIds(ids, seed, salt) {
  const out = ids.slice();
  let s = (seed ^ (salt * 0x9e3779b1)) >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function createReserveDeckState(rngSeed) {
  return {
    community: {
      deck: shuffleIds(RESERVE_DECKS.community.map((c) => c.id), rngSeed, 5),
      discard: []
    },
    chance: {
      deck: shuffleIds(RESERVE_DECKS.chance.map((c) => c.id), rngSeed, 6),
      discard: []
    }
  };
}

export function hydrateReserveDecks(state) {
  if (!state.reserveDecks) {
    state.reserveDecks = createReserveDeckState(state.rngSeed ?? 0);
  } else {
    for (const d of ['community', 'chance']) {
      if (!state.reserveDecks[d]) {
        state.reserveDecks[d] = {
          deck: shuffleIds(RESERVE_DECKS[d].map((c) => c.id), state.rngSeed ?? 0, d === 'community' ? 5 : 6),
          discard: []
        };
      } else {
        if (!Array.isArray(state.reserveDecks[d].deck)) state.reserveDecks[d].deck = [];
        if (!Array.isArray(state.reserveDecks[d].discard)) state.reserveDecks[d].discard = [];
      }
    }
  }
}

// ---------- DRAW ----------

// Pulls the top card id from the named deck. If the deck is empty, the
// discard pile is reshuffled into a fresh deck first. Returns the card id, or
// null if both piles are empty (shouldn't happen with our static catalogs).
export function drawReserveCard(state, deckName, rng) {
  const slot = state.reserveDecks?.[deckName];
  if (!slot) return null;
  if (slot.deck.length === 0) {
    if (slot.discard.length === 0) return null;
    const reshuffled = slot.discard.slice();
    for (let i = reshuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [reshuffled[i], reshuffled[j]] = [reshuffled[j], reshuffled[i]];
    }
    slot.deck = reshuffled;
    slot.discard = [];
  }
  return slot.deck.shift();
}

export function discardReserveCard(state, deckName, cardId) {
  const slot = state.reserveDecks?.[deckName];
  if (!slot) return;
  slot.discard.push(cardId);
}

// ---------- RESOLVE ----------

// Resolves a single drawn card. Returns a `results` object describing what
// happened (used for client display + structured logging).
export function applyEventCard(state, seatIndex, deckName, cardId, ctx, log) {
  const card = getEventCard(deckName, cardId);
  if (!card) return { error: 'UNKNOWN_CARD' };
  const seat = state.seats[seatIndex];
  if (!seat) return { error: 'NO_SEAT' };

  const results = { cardId, deck: deckName, seatIndex, effects: [] };
  for (const eff of card.effects) {
    const out = applyEffect(state, seat, eff, ctx);
    results.effects.push({ kind: eff.kind, ...out });
  }
  return { ok: true, results };
}

function applyEffect(state, seat, eff, ctx) {
  switch (eff.kind) {
    case 'cash':
      return applyCash(seat, eff.amount);
    case 'creditScoreDelta':
      return applyCreditScoreDelta(seat, eff.amount);
    case 'dividend':
      return applyDividend(seat, state.stocks, eff.symbol, eff.pct);
    case 'flatDividend':
      return applyFlatDividend(seat, eff.amount, eff.requireAnyShares);
    case 'shareGrant':
      return applyShareGrant(seat, eff.symbol, eff.qty);
    case 'shareGrantAll':
      return applyShareGrantAll(seat, eff.qty);
    case 'marketShock':
      return applyMarketShock(state.stocks, eff.pct);
    case 'stockShock':
      return applyStockShock(state.stocks, eff.symbol, eff.pct);
    case 'tempEffect':
      return applyTempEffect(seat, eff);
    case 'specialLoan':
      return applySpecialLoan(seat, eff);
    case 'bankPaysInstallment':
      return applyBankPaysInstallment(seat);
    default:
      return { skipped: true, reason: 'UNKNOWN_EFFECT' };
  }
}

// ---------- EFFECT IMPLEMENTATIONS ----------

function applyCash(seat, amount) {
  seat.cash = Math.round((seat.cash + amount) * 100) / 100;
  return { amount };
}

function applyCreditScoreDelta(seat, amount) {
  const before = seat.creditScore ?? 0;
  seat.creditScore = Math.max(300, Math.min(1200, before + amount));
  return { delta: amount, scoreBefore: before, scoreAfter: seat.creditScore };
}

function applyDividend(seat, stocks, symbol, pct) {
  if (!stocks?.market?.[symbol]) return { paid: 0 };
  const shares = seat.stockLots?.[symbol] ?? 0;
  if (shares <= 0) return { paid: 0, symbol, shares: 0 };
  const price = stocks.market[symbol].price ?? 0;
  const paid = Math.round(shares * price * pct * 100) / 100;
  seat.cash = Math.round((seat.cash + paid) * 100) / 100;
  return { paid, symbol, shares, price, pct };
}

function applyFlatDividend(seat, amount, requireAnyShares) {
  if (requireAnyShares) {
    const owns = Object.values(seat.stockLots ?? {}).some((q) => q > 0);
    if (!owns) return { paid: 0, reason: 'NO_SHARES' };
  }
  seat.cash = Math.round((seat.cash + amount) * 100) / 100;
  return { paid: amount };
}

function applyShareGrant(seat, symbol, qty) {
  if (!STOCK_CATALOG[symbol] || STOCK_CATALOG[symbol].type !== 'volatile') {
    return { granted: 0, reason: 'BAD_SYMBOL' };
  }
  seat.stockLots[symbol] = (seat.stockLots[symbol] || 0) + qty;
  // Inherited shares have $0 cost basis — pure upside.
  return { granted: qty, symbol };
}

function applyShareGrantAll(seat, qty) {
  for (const sym of VOLATILE_STOCK_ORDER) {
    seat.stockLots[sym] = (seat.stockLots[sym] || 0) + qty;
  }
  return { granted: qty, symbols: VOLATILE_STOCK_ORDER.slice() };
}

function applyMarketShock(stocks, pct) {
  if (!stocks?.market) return { skipped: true };
  const moves = {};
  for (const sym of VOLATILE_STOCK_ORDER) {
    const m = stocks.market[sym];
    if (!m) continue;
    const before = m.price;
    const next = Math.max(0.01, Math.round(m.price * (1 + pct / 100) * 100) / 100);
    m.price = next;
    m.lastFlipPct = pct;
    m.lastCard = pct;
    m.history = Array.isArray(m.history) ? m.history.concat(next) : [next];
    moves[sym] = { from: before, to: next };
  }
  recalcFP500(stocks);
  const fp = stocks.market[FP500_SYMBOL];
  if (fp) fp.history = Array.isArray(fp.history) ? fp.history.concat(fp.price) : [fp.price];
  return { pct, moves };
}

function applyStockShock(stocks, symbol, pct) {
  if (!stocks?.market?.[symbol] || STOCK_CATALOG[symbol]?.type !== 'volatile') {
    return { skipped: true, reason: 'BAD_SYMBOL' };
  }
  const m = stocks.market[symbol];
  const before = m.price;
  const next = Math.max(0.01, Math.round(m.price * (1 + pct / 100) * 100) / 100);
  m.price = next;
  m.lastFlipPct = pct;
  m.lastCard = pct;
  m.history = Array.isArray(m.history) ? m.history.concat(next) : [next];
  recalcFP500(stocks);
  const fp = stocks.market[FP500_SYMBOL];
  if (fp) fp.history = Array.isArray(fp.history) ? fp.history.concat(fp.price) : [fp.price];
  return { symbol, pct, from: before, to: next };
}

function applyTempEffect(seat, eff) {
  EFFECT_ID_COUNTER += 1;
  const entry = {
    id: `TE-${seat.seat}-${EFFECT_ID_COUNTER}`,
    effectId: eff.effectId,
    expiresInTurns: eff.turns,
    payload: eff.payload ?? null
  };
  seat.tempEffects = Array.isArray(seat.tempEffects) ? seat.tempEffects : [];
  seat.tempEffects.push(entry);
  return { effectId: eff.effectId, turns: eff.turns };
}

function applySpecialLoan(seat, eff) {
  const principal = eff.principal;
  const term = eff.term;
  const ptr = eff.ptr;
  const totalDebt = Math.round(principal * (1 + ptr * term) * 100) / 100;
  const installment = Math.round((totalDebt / term) * 100) / 100;
  const loan = {
    id: `SL-${seat.seat}-${seat.loans.length}-${Date.now()}`,
    principal,
    term,
    ptr,
    totalDebt,
    installment,
    paymentsMade: 0,
    balance: totalDebt,
    takenAt: Date.now(),
    dueThisTurn: false,
    status: 'active',
    source: 'eventCard'
  };
  seat.loans.push(loan);
  seat.cash = Math.round((seat.cash + principal) * 100) / 100;
  return { principal, term, ptr, totalDebt, installment, loanId: loan.id };
}

function applyBankPaysInstallment(seat) {
  // Find the next active loan (prefers any loan currently due).
  const due = seat.loans.find((l) => l.status === 'active' && l.dueThisTurn);
  const target = due ?? seat.loans.find((l) => l.status === 'active');
  if (!target) return { skipped: true, reason: 'NO_LOAN' };
  const amount = Math.min(target.installment, target.balance);
  target.balance = Math.round((target.balance - amount) * 100) / 100;
  target.paymentsMade += 1;
  if (target === due) target.dueThisTurn = false;
  if (target.paymentsMade >= target.term || target.balance <= 0.0001) {
    target.balance = 0;
    target.status = 'closed';
  }
  return { loanId: target.id, amount };
}

// ---------- TEMP-EFFECT LIFECYCLE ----------

// Decrement each effect by 1 turn; remove any with expiresInTurns <= 0.
// Called at the start of each seat's turn.
export function decayTempEffects(seat) {
  if (!Array.isArray(seat.tempEffects) || seat.tempEffects.length === 0) return [];
  const expired = [];
  const remaining = [];
  for (const e of seat.tempEffects) {
    const next = (e.expiresInTurns ?? 0) - 1;
    if (next <= 0) {
      expired.push(e);
    } else {
      remaining.push({ ...e, expiresInTurns: next });
    }
  }
  seat.tempEffects = remaining;
  return expired;
}

export function hasTempEffect(seat, effectId) {
  if (!Array.isArray(seat?.tempEffects)) return false;
  return seat.tempEffects.some((e) => e.effectId === effectId);
}
