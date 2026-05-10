import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng } from './helpers.js';
import {
  getCardLineBonusFor,
  getMissedPaymentPenalty,
  getPtrDiscountFor,
  meetsTierRequirement
} from '../../shared/reserve/cardCatalog.js';
import { hydrateRoom } from '../createGame.js';
import {
  chargeCard,
  payCardBalance,
  accrueCardInterest
} from '../reserve/cards.js';

function step(state, action, ctx = { rng: makeRng() }) {
  const r = reducer(state, action, ctx);
  if (!r.ok) throw new Error('reducer error: ' + r.error);
  return r.state;
}

// ---------- catalog ----------

test('meetsTierRequirement compares tiers correctly', () => {
  assert.equal(meetsTierRequirement({ creditScore: 720 }, 'Good'), true);     // Good vs Good
  assert.equal(meetsTierRequirement({ creditScore: 720 }, 'Very Good'), false); // Good vs VG
  assert.equal(meetsTierRequirement({ creditScore: 800 }, 'Excellent'), true);
  assert.equal(meetsTierRequirement({ creditScore: 800 }, 'Fair'), true);
});

test('getCardLineBonusFor sums active card maxLineBonus values', () => {
  const seat = { creditScore: 800, creditCards: [
    { id: 'b', cardId: 'boardwalkPreferred', status: 'active' }
  ]};
  assert.equal(getCardLineBonusFor(seat), 0.4);
  assert.equal(getCardLineBonusFor({ creditCards: [] }), 0);
});

test('getMissedPaymentPenalty returns lowest override (Vault Platinum: 5)', () => {
  const seat = { creditScore: 800, creditCards: [
    { id: 'a', cardId: 'vaultPlatinum', status: 'active' }
  ]};
  assert.equal(getMissedPaymentPenalty(seat), 5);
  // No override: default 10
  assert.equal(getMissedPaymentPenalty({ creditCards: [] }), 10);
});

test('getPtrDiscountFor sums active card discounts', () => {
  const seat = { creditCards: [
    { id: 'a', cardId: 'primeAdvantage', status: 'active' }
  ]};
  assert.equal(getPtrDiscountFor(seat), 0.02);
  assert.equal(getPtrDiscountFor({ creditCards: [] }), 0);
});

// ---------- apply / cancel ----------

test('requestCreditCard: rejects when tier too low', () => {
  const s = makeRoom(2);
  s.seats[0].creditScore = 600; // Fair
  const r = reducer(s, { type: 'requestCreditCard', seat: 0, cardId: 'boardwalkPreferred' }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'TIER_TOO_LOW');
});

test('requestCreditCard: Vault Platinum requires Excellent (rejects Very Good 799)', () => {
  const s = makeRoom(2);
  s.seats[0].creditScore = 799; // one shy of Excellent (800)
  const r = reducer(s, { type: 'requestCreditCard', seat: 0, cardId: 'vaultPlatinum' }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'TIER_TOO_LOW');
});

test('requestCreditCard: rejects when can\'t afford signing fee', () => {
  const s = makeRoom(2);
  s.seats[0].creditScore = 800;
  s.seats[0].cash = 10;
  const r = reducer(s, { type: 'requestCreditCard', seat: 0, cardId: 'boardwalkPreferred' }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS');
});

test('requestCreditCard: debits signing fee and adds to creditCards', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 800;
  const cashBefore = s.seats[0].cash;
  s = step(s, { type: 'requestCreditCard', seat: 0, cardId: 'vaultPlatinum' });
  assert.equal(s.seats[0].creditCards.length, 1);
  assert.equal(s.seats[0].creditCards[0].cardId, 'vaultPlatinum');
  assert.equal(s.seats[0].creditCards[0].status, 'active');
  // signingFee=400, signupBonus=0 → net -400
  assert.equal(s.seats[0].cash, cashBefore - 400 + 0);
});

test('requestCreditCard: rejects second card from the same bank (per-bank uniqueness)', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 800;
  s = step(s, { type: 'requestCreditCard', seat: 0, cardId: 'vaultPlatinum' });
  const r = reducer(s, { type: 'requestCreditCard', seat: 0, cardId: 'boardwalkPreferred' }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'BANK_LIMIT_REACHED');
});

test('cancelCreditCard: charges cancel fee and marks status cancelled', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 800;
  s = step(s, { type: 'requestCreditCard', seat: 0, cardId: 'readingRail' });
  const inst = s.seats[0].creditCards[0];
  const cashBefore = s.seats[0].cash;
  s = step(s, { type: 'cancelCreditCard', seat: 0, instanceId: inst.id });
  assert.equal(s.seats[0].creditCards[0].status, 'cancelled');
  // cancelFee=400
  assert.equal(s.seats[0].cash, cashBefore - 400);
});

// ---------- integration with loans ----------

test('loan offer: Boardwalk Preferred boosts max line allowing larger principal', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 750;
  s.seats[0].cash = 280;
  let r = reducer(s, { type: 'requestLoan', seat: 0, amount: 600 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'EXCEEDS_MAX_LINE');
  s.seats[0].creditCards.push({ id: 'CC-bp', cardId: 'boardwalkPreferred', status: 'active' });
  s = step(s, { type: 'requestLoan', seat: 0, amount: 600 });
  assert.ok(s.seats[0].pendingLoanOffer);
});

test('loan offer: Prime Advantage discounts PTR by 2%', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 750;
  // Baseline: take an offer without the card and remember the lowest PTR.
  let s1 = step(s, { type: 'requestLoan', seat: 0, amount: 100 }, { rng: makeRng(42) });
  const baselinePtr = s1.seats[0].pendingLoanOffer.options[0].ptr;
  // Same seat, same dice (same RNG seed), but with Prime Advantage.
  let s2 = makeRoom(2);
  s2.seats[0].creditScore = 750;
  s2.seats[0].creditCards.push({ id: 'CC-pa', cardId: 'primeAdvantage', status: 'active' });
  s2 = step(s2, { type: 'requestLoan', seat: 0, amount: 100 }, { rng: makeRng(42) });
  const cardPtr = s2.seats[0].pendingLoanOffer.options[0].ptr;
  assert.ok(Math.abs(baselinePtr - cardPtr - 0.02) < 0.0001, `expected ${baselinePtr} - 0.02 = ${cardPtr}`);
});

test('skipLoanInstallment: Vault Platinum reduces credit penalty to 5', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 750;
  s.seats[0].creditCards.push({ id: 'CC-vp', cardId: 'vaultPlatinum', status: 'active' });
  s.seats[0].loans.push({
    id: 'L-test',
    principal: 100, term: 3, ptr: 0.05, totalDebt: 115,
    installment: 38.33, paymentsMade: 0, balance: 115,
    takenAt: 0, dueThisTurn: true, status: 'active'
  });
  s.seats[0].loanTurnResponded = false;
  s = step(s, { type: 'skipLoanInstallment', seat: 0, loanId: 'L-test' });
  assert.equal(s.seats[0].creditScore, 750 - 5); // Vault Platinum override
});

// ---------- balance: charge / pay / interest ----------

function activeVpCard(seat, balance = 0) {
  // Vault Platinum has minLine 1200, interestRate 0.20.
  const inst = { id: 'CC-vp', cardId: 'vaultPlatinum', status: 'active', balance };
  seat.creditCards.push(inst);
  return inst;
}

test('chargeCard adds to balance and respects per-card minLine cap', () => {
  const s = makeRoom(2);
  activeVpCard(s.seats[0], 0);
  let r = chargeCard(s.seats[0], 'CC-vp', 800);
  assert.equal(r.ok, true);
  assert.equal(r.balance, 800);
  assert.equal(r.limit, 1200);
  // Second charge inside the limit.
  r = chargeCard(s.seats[0], 'CC-vp', 400);
  assert.equal(r.ok, true);
  assert.equal(r.balance, 1200);
  // Third charge: would exceed limit by $0.01 → rejected.
  r = chargeCard(s.seats[0], 'CC-vp', 0.01);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_CREDIT');
  assert.equal(r.available, 0);
  // Balance must not have moved on the failed attempt.
  assert.equal(s.seats[0].creditCards[0].balance, 1200);
});

test('chargeCard rejects on cancelled or unknown card', () => {
  const s = makeRoom(2);
  activeVpCard(s.seats[0], 0);
  s.seats[0].creditCards[0].status = 'cancelled';
  let r = chargeCard(s.seats[0], 'CC-vp', 100);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NO_CARD');
  r = chargeCard(s.seats[0], 'CC-doesnotexist', 100);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NO_CARD');
});

test('payCardBalance debits cash, reduces balance, caps at outstanding', () => {
  const s = makeRoom(2);
  s.seats[0].cash = 1000;
  activeVpCard(s.seats[0], 300);
  // Partial payment.
  let r = payCardBalance(s.seats[0], 'CC-vp', 100);
  assert.equal(r.ok, true);
  assert.equal(r.paid, 100);
  assert.equal(r.balance, 200);
  assert.equal(s.seats[0].cash, 900);
  // Over-pay caps at outstanding ($200), not the requested $500.
  r = payCardBalance(s.seats[0], 'CC-vp', 500);
  assert.equal(r.ok, true);
  assert.equal(r.paid, 200);
  assert.equal(r.balance, 0);
  assert.equal(s.seats[0].cash, 700);
  // Paying with no balance left → NO_BALANCE.
  r = payCardBalance(s.seats[0], 'CC-vp', 50);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NO_BALANCE');
});

test('accrueCardInterest only fires on cycle multiples of 4 and skips zero-balance / cancelled', () => {
  const s = makeRoom(2);
  s.seats[0].cash = 0;
  const vp = activeVpCard(s.seats[0], 500);
  for (const cycle of [0, 1, 2, 3, 5, 6, 7]) {
    const ev = accrueCardInterest(s.seats, cycle);
    assert.equal(ev.length, 0, `cycle ${cycle} should not accrue`);
  }
  assert.equal(vp.balance, 500);
  let ev = accrueCardInterest(s.seats, 4);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].interest, 100);
  assert.equal(vp.balance, 600);
  vp.status = 'cancelled';
  ev = accrueCardInterest(s.seats, 8);
  assert.equal(ev.length, 0);
  assert.equal(vp.balance, 600);
  vp.status = 'active';
  vp.balance = 0;
  ev = accrueCardInterest(s.seats, 8);
  assert.equal(ev.length, 0);
});

test('cancelCreditCard rejects when card has an outstanding balance', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 800;
  activeVpCard(s.seats[0], 50);
  const r = reducer(
    s,
    { type: 'cancelCreditCard', seat: 0, instanceId: 'CC-vp' },
    { rng: makeRng() }
  );
  assert.equal(r.ok, false);
  assert.equal(r.error, 'OUTSTANDING_BALANCE');
});

// ---------- reducer flows: buy with card ----------

test('buyPropertyWithCard: charges card, transfers ownership, no cash debited', () => {
  let s = makeRoom(2);
  // Land seat 0 on Mediterranean (index 1, $60).
  s.turn = { seat: 0, phase: 'endable', lastRoll: [1, 0], doublesCount: 0 };
  s.seats[0].position = 1;
  s.pendingAction = { type: 'buyDecision', seat: 0, spaceIndex: 1, price: 60 };
  activeVpCard(s.seats[0], 0);
  const cashBefore = s.seats[0].cash;
  s = step(s, { type: 'buyPropertyWithCard', seat: 0, instanceId: 'CC-vp', spaceIndex: 1 });
  assert.equal(s.properties[1].ownerSeat, 0);
  assert.equal(s.seats[0].cash, cashBefore, 'cash must not move when paying with card');
  assert.equal(s.seats[0].creditCards[0].balance, 60);
  assert.equal(s.pendingAction, null);
});

test('buyPropertyWithCard: rejects when price exceeds the card credit line', () => {
  let s = makeRoom(2);
  // Boardwalk (index 39) is $400; Reading Rail card has minLine $200.
  s.turn = { seat: 0, phase: 'endable', lastRoll: [1, 0], doublesCount: 0 };
  s.seats[0].position = 39;
  s.pendingAction = { type: 'buyDecision', seat: 0, spaceIndex: 39, price: 400 };
  s.seats[0].creditCards.push({ id: 'CC-rr', cardId: 'readingRail', status: 'active', balance: 0 });
  const r = reducer(
    s,
    { type: 'buyPropertyWithCard', seat: 0, instanceId: 'CC-rr', spaceIndex: 39 },
    { rng: makeRng() }
  );
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_CREDIT');
  // No state mutation on the rejected attempt.
  assert.equal(s.properties[39].ownerSeat, null);
  assert.equal(s.seats[0].creditCards[0].balance, 0);
});

test('buyStockWithCard: credits shares, charges card, no cash moves', () => {
  let s = makeRoom(2);
  activeVpCard(s.seats[0], 0);
  const cashBefore = s.seats[0].cash;
  const price = s.stocks.market.TPHT.price;
  s = step(s, { type: 'buyStockWithCard', seat: 0, symbol: 'TPHT', qty: 2, instanceId: 'CC-vp' });
  assert.equal(s.seats[0].stockLots.TPHT, 2);
  const expectedCost = Math.round(price * 2 * 100) / 100;
  assert.equal(s.seats[0].stockCostBasis.TPHT, expectedCost);
  assert.equal(s.seats[0].creditCards[0].balance, expectedCost);
  assert.equal(s.seats[0].cash, cashBefore);
});

test('buyStockWithCard: rejects when cost exceeds card limit', () => {
  let s = makeRoom(2);
  // Reading Rail has minLine $200; force a price that makes 50 shares > $200.
  s.stocks.market.TPHT.price = 5;
  s.seats[0].creditCards.push({ id: 'CC-rr', cardId: 'readingRail', status: 'active', balance: 0 });
  const r = reducer(
    s,
    { type: 'buyStockWithCard', seat: 0, symbol: 'TPHT', qty: 50, instanceId: 'CC-rr' },
    { rng: makeRng() }
  );
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_CREDIT');
  assert.equal(s.seats[0].stockLots.TPHT ?? 0, 0);
  assert.equal(s.seats[0].creditCards[0].balance, 0);
});

test('payCardBalance via reducer: cash debited, balance reduced', () => {
  let s = makeRoom(2);
  s.seats[0].cash = 500;
  activeVpCard(s.seats[0], 300);
  s = step(s, { type: 'payCardBalance', seat: 0, instanceId: 'CC-vp', amount: 200 });
  assert.equal(s.seats[0].cash, 300);
  assert.equal(s.seats[0].creditCards[0].balance, 100);
});

// ---------- end-of-turn hook: interest accrues every 4 cycles ----------

test('end-turn at 4-cycle boundary accrues interest on active card balances', () => {
  let s = makeRoom(2);
  s.turnCount = 3;
  s.economy.reserveRate = 0;
  s.seats[0].cash = 0;
  activeVpCard(s.seats[0], 500);
  s.turn = { seat: 0, phase: 'endable', lastRoll: [1, 2], doublesCount: 0 };
  const r = reducer(s, { type: 'endTurn', seat: 0 }, { rng: makeRng() });
  assert.equal(r.ok, true);
  assert.equal(r.state.seats[0].creditCards[0].balance, 600);
  const ev = r.events.find((e) => e.type === 'cardInterest');
  assert.ok(ev, 'expected a cardInterest log event');
  assert.equal(ev.payload.interest, 100);
  assert.equal(ev.payload.balance, 600);
});

test('end-turn off-boundary does NOT accrue interest', () => {
  let s = makeRoom(2);
  s.turnCount = 0; // next end-turn → 1, not a boundary
  activeVpCard(s.seats[0], 500);
  s.turn = { seat: 0, phase: 'endable', lastRoll: [1, 2], doublesCount: 0 };
  const r = reducer(s, { type: 'endTurn', seat: 0 }, { rng: makeRng() });
  assert.equal(r.ok, true);
  assert.equal(r.state.seats[0].creditCards[0].balance, 500, 'no interest off-boundary');
});

test('hydrateRoom backfills balance: 0 on legacy creditCards loaded from disk', () => {
  // Simulate a room loaded from disk: card instance lacks the new balance field.
  const s = makeRoom(2);
  s.seats[0].creditCards = [{ id: 'CC-legacy', cardId: 'goRewards', status: 'active' }];
  hydrateRoom(s);
  assert.equal(s.seats[0].creditCards[0].balance, 0);
});
