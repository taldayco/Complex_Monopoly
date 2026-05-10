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
import { clampCreditScore } from '../../shared/reserve/loanCatalog.js';
import { COLOR_GROUPS } from '../../shared/constants.js';
import { recalcFP500, buyShares, sellShares } from './stocks.js';

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
    case 'revealWildcards':
      return applyRevealWildcards(state, seat, eff.symbol);
    case 'cashAllSeats':
      return applyCashAllSeats(state, eff.amount);
    case 'inflationDelta':
      return applyInflationDelta(state, eff.amount);
    case 'dividendAll':
      return applyDividendAll(seat, state.stocks, eff.pct);
    case 'shortSqueeze':
      return applyShortSqueeze(state.stocks, eff.pct);
    case 'classEnvy':
      return applyClassEnvy(state, eff.amount);
    case 'antitrust':
      return applyAntitrust(state, eff.amount);
    case 'boardwalkScandal':
      return applyBoardwalkScandal(state, eff.amount);
    case 'predatoryLawsuit':
      return applyPredatoryLawsuit(state, eff.creditDelta, eff.cashAmount);
    case 'regionalBankFailure':
      return applyRegionalBankFailure(state, ctx);
    case 'maintenanceBill':
      return applyMaintenanceBill(state, seat, eff.perHouse, eff.perHotel);
    case 'taxAppeal':
      return applyTaxAppeal(state, seat, eff.perDevelopedProperty);
    case 'devModifier':
      return applyDevModifier(seat, eff.amount, eff.oneHouseOnly);
    case 'permitFeeModifier':
      return applyPermitFeeModifier(seat, eff.amount);
    case 'grantInventory':
      return applyGrantInventory(seat, eff.item, eff.qty);
    case 'wrongfullyAccused':
      return applyWrongfullyAccused(seat);
    case 'financialCrisis':
      return applyFinancialCrisis(state, eff.inflationFreezeTurns, eff.interestFreezeTurns);
    case 'fixedTradeStock':
      return applyFixedTradeStock(state, seat, eff.symbol, eff.qty, eff.price, eff.direction);
    case 'cardChoice':
      return emitCardChoice(state, seat, eff);
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
  seat.creditScore = clampCreditScore(before + amount);
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

// Privately reveals a stock's wildcards to the drawing seat. Wildcards are
// re-randomized on each deck reshuffle, so the reveal is sourced from the
// live deck (not the catalog). Reveals are wiped automatically when the deck
// reshuffles — see `clearStaleWildcardReveals` in reducer.js and the
// reshuffle handling in marketOpen.js.
function applyRevealWildcards(state, seat, symbol) {
  const cat = STOCK_CATALOG[symbol];
  if (!cat || cat.type !== 'volatile') {
    return { skipped: true, reason: 'BAD_SYMBOL' };
  }
  const market = state.stocks?.market?.[symbol];
  const deck = Array.isArray(market?.deck) ? market.deck : [];
  const values = deck.filter((c) => c && c.wild).map((c) => c.value);
  const inDeck = values.length;
  if (!seat.revealedWildcards || typeof seat.revealedWildcards !== 'object') {
    seat.revealedWildcards = {};
  }
  seat.revealedWildcards[symbol] = values;
  return { symbol, wildCards: values, inDeck };
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

function applyCashAllSeats(state, amount) {
  const recipients = [];
  for (const s of state.seats) {
    if (s.bankrupt) continue;
    s.cash = Math.round((s.cash + amount) * 100) / 100;
    recipients.push(s.seat);
  }
  return { amount, recipients };
}

function applyInflationDelta(state, amount) {
  if (!state.economy) return { skipped: true };
  const before = state.economy.inflationFactor ?? 1;
  state.economy.inflationFactor = Math.round((before + amount) * 1000) / 1000;
  return { delta: amount, before, after: state.economy.inflationFactor };
}

function applyDividendAll(seat, stocks, pct) {
  if (!stocks?.market) return { paid: 0 };
  let total = 0;
  const breakdown = [];
  for (const sym of Object.keys(seat.stockLots ?? {})) {
    const shares = seat.stockLots[sym] ?? 0;
    if (shares <= 0) continue;
    const price = stocks.market[sym]?.price ?? 0;
    const paid = Math.round(shares * price * pct * 100) / 100;
    if (paid > 0) {
      total += paid;
      breakdown.push({ symbol: sym, shares, price, paid });
    }
  }
  if (total > 0) seat.cash = Math.round((seat.cash + total) * 100) / 100;
  return { paid: total, breakdown };
}

function applyShortSqueeze(stocks, pct) {
  if (!stocks?.market) return { skipped: true };
  let worstSym = null;
  let worstPrice = Infinity;
  for (const sym of VOLATILE_STOCK_ORDER) {
    const price = stocks.market[sym]?.price ?? Infinity;
    if (price < worstPrice) {
      worstPrice = price;
      worstSym = sym;
    }
  }
  if (!worstSym) return { skipped: true };
  return applyStockShock(stocks, worstSym, pct);
}

function applyClassEnvy(state, amount) {
  let richest = null;
  let poorest = null;
  for (const s of state.seats) {
    if (s.bankrupt) continue;
    if (richest == null || s.cash > state.seats[richest].cash) richest = s.seat;
    if (poorest == null || s.cash < state.seats[poorest].cash) poorest = s.seat;
  }
  if (richest == null || poorest == null || richest === poorest) return { skipped: true };
  const r = state.seats[richest];
  const p = state.seats[poorest];
  const transfer = Math.min(amount, r.cash);
  r.cash = Math.round((r.cash - transfer) * 100) / 100;
  p.cash = Math.round((p.cash + transfer) * 100) / 100;
  return { richest, poorest, transferred: transfer };
}

function applyAntitrust(state, amount) {
  const debited = [];
  for (const s of state.seats) {
    if (s.bankrupt) continue;
    let ownsFullGroup = false;
    for (const groupName of Object.keys(COLOR_GROUPS)) {
      const indices = COLOR_GROUPS[groupName];
      const allOwned = indices.every((i) => state.properties[i]?.ownerSeat === s.seat);
      if (allOwned) {
        ownsFullGroup = true;
        break;
      }
    }
    if (!ownsFullGroup) continue;
    const debit = Math.min(amount, s.cash);
    s.cash = Math.round((s.cash - debit) * 100) / 100;
    debited.push({ seat: s.seat, amount: debit });
  }
  return { debited };
}

function applyBoardwalkScandal(state, amount) {
  const debited = [];
  for (const s of state.seats) {
    if (s.bankrupt) continue;
    const hasBoardwalkAccount = s.bankAccounts?.boardwalk?.open === true;
    if (!hasBoardwalkAccount) continue;
    const isExcellent = (s.creditScore ?? 0) >= 800;
    if (isExcellent) continue;
    const debit = Math.min(amount, s.cash);
    s.cash = Math.round((s.cash - debit) * 100) / 100;
    debited.push({ seat: s.seat, amount: debit });
  }
  return { debited };
}

function applyPredatoryLawsuit(state, creditDelta, cashAmount) {
  let target = null;
  let mostLoans = -1;
  for (const s of state.seats) {
    if (s.bankrupt) continue;
    const count = (s.loans ?? []).filter((l) => l?.status === 'active').length;
    if (count > mostLoans) {
      mostLoans = count;
      target = s.seat;
    }
  }
  if (target == null || mostLoans <= 0) return { skipped: true };
  const seat = state.seats[target];
  seat.creditScore = clampCreditScore((seat.creditScore ?? 720) + creditDelta);
  seat.cash = Math.round((seat.cash + cashAmount) * 100) / 100;
  return { recipient: target, creditDelta, cashAmount };
}

function applyRegionalBankFailure(state, ctx) {
  const rng = ctx?.rng ?? Math.random;
  const die = Math.floor(rng() * 6) + 1;
  const bank = die % 2 === 1 ? 'mmcu' : 'boardwalk';
  const FDIC_CAP = 5000;
  const losses = [];
  for (const s of state.seats) {
    if (s.bankrupt) continue;
    const acct = s.bankAccounts?.[bank];
    if (!acct?.open) continue;
    if ((acct.balance ?? 0) > FDIC_CAP) {
      const lost = Math.round((acct.balance - FDIC_CAP) * 100) / 100;
      acct.balance = FDIC_CAP;
      losses.push({ seat: s.seat, lost });
    }
  }
  return { die, bank, losses };
}

function applyMaintenanceBill(state, seat, perHouse, perHotel) {
  let owed = 0;
  for (const idx of Object.keys(state.properties ?? {})) {
    const prop = state.properties[idx];
    if (prop?.ownerSeat !== seat.seat) continue;
    const h = prop.houses ?? 0;
    if (h === 0) continue;
    if (h === 5) owed += perHotel;
    else owed += perHouse * h;
  }
  const debit = Math.min(owed, seat.cash);
  seat.cash = Math.round((seat.cash - debit) * 100) / 100;
  return { owed, debited: debit };
}

function applyTaxAppeal(state, seat, perDevelopedProperty) {
  let count = 0;
  for (const idx of Object.keys(state.properties ?? {})) {
    const prop = state.properties[idx];
    if (prop?.ownerSeat !== seat.seat) continue;
    if ((prop.houses ?? 0) > 0) count += 1;
  }
  const credit = count * perDevelopedProperty;
  seat.cash = Math.round((seat.cash + credit) * 100) / 100;
  return { credited: credit, properties: count };
}

function applyDevModifier(seat, amount, oneHouseOnly) {
  seat.nextDevModifier = { amount, oneHouseOnly: !!oneHouseOnly, consumed: false };
  return { amount, oneHouseOnly: !!oneHouseOnly };
}

function applyPermitFeeModifier(seat, amount) {
  seat.nextPermitFeeModifier = { amount, consumed: false };
  return { amount };
}

function applyGrantInventory(seat, item, qty) {
  if (!seat.eventInventory) seat.eventInventory = { getOutOfJailFree: 0, avoidJail: 0 };
  if (typeof seat.eventInventory[item] !== 'number') seat.eventInventory[item] = 0;
  seat.eventInventory[item] += qty;
  return { item, qty, total: seat.eventInventory[item] };
}

function applyWrongfullyAccused(seat) {
  if (seat.inJail) {
    seat.inJail = false;
    seat.jailTurns = 0;
    seat.cash = Math.round((seat.cash + 200) * 100) / 100;
    return { released: true, paid: 200 };
  }
  return applyGrantInventory(seat, 'wrongfullyAccused', 1);
}

function applyFixedTradeStock(state, seat, symbol, qty, fixedPrice, direction) {
  if (!state.stocks?.market?.[symbol]) return { skipped: true, reason: 'UNKNOWN_STOCK' };
  const livePrice = state.stocks.market[symbol].price;
  state.stocks.market[symbol].price = fixedPrice;
  let result;
  try {
    if (direction === 'buy') result = buyShares(seat, state.stocks, symbol, qty);
    else result = sellShares(seat, state.stocks, symbol, qty);
  } finally {
    state.stocks.market[symbol].price = livePrice;
  }
  if (!result?.ok) return { skipped: true, reason: result?.error ?? 'TRADE_FAILED' };
  return { direction, symbol, qty, fixedPrice, ...result };
}

function emitCardChoice(state, seat, eff) {
  let options = [];
  if (eff.kind === 'cardChoice' && eff.choiceKind === 'stockUpgrade') {
    options = VOLATILE_STOCK_ORDER.slice();
  } else if (eff.choiceKind === 'insiderTip') {
    options = VOLATILE_STOCK_ORDER.slice();
  } else if (eff.choiceKind === 'rateDiscount' || eff.choiceKind === 'refinance') {
    options = (seat.loans ?? [])
      .filter((l) => l?.status === 'active' && l.balance > 0)
      .map((l) => l.id);
    if (options.length === 0) return { skipped: true, reason: 'NO_ACTIVE_LOANS' };
  } else {
    return { skipped: true, reason: 'UNKNOWN_CHOICE_KIND' };
  }
  state.pendingCardChoice = {
    seat: seat.seat,
    kind: eff.choiceKind,
    amount: typeof eff.amount === 'number' ? eff.amount : 0,
    options
  };
  return { kind: eff.choiceKind, options };
}

function applyFinancialCrisis(state, inflationFreezeTurns = 10, interestFreezeTurns = 8) {
  if (!state.economy) return { skipped: true };
  state.economy.inflationFactor = 1;
  if (!Array.isArray(state.economy.tempEffects)) state.economy.tempEffects = [];
  const turnCount = state.turnCount ?? 0;
  state.economy.tempEffects.push({
    kind: 'inflationFreeze',
    expiresAtTurn: turnCount + inflationFreezeTurns
  });
  state.economy.tempEffects.push({
    kind: 'interestFreeze',
    expiresAtTurn: turnCount + interestFreezeTurns
  });
  const FDIC_CAP = 5000;
  const losses = [];
  for (const s of state.seats ?? []) {
    if (s.bankrupt) continue;
    for (const bank of ['mmcu', 'boardwalk']) {
      const acct = s.bankAccounts?.[bank];
      if (!acct?.open) continue;
      if ((acct.balance ?? 0) > FDIC_CAP) {
        const lost = Math.round((acct.balance - FDIC_CAP) * 100) / 100;
        acct.balance = FDIC_CAP;
        losses.push({ seat: s.seat, bank, lost });
      }
    }
  }
  return {
    inflationReset: 1,
    inflationFreezeUntil: turnCount + inflationFreezeTurns,
    interestFreezeUntil: turnCount + interestFreezeTurns,
    losses
  };
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
