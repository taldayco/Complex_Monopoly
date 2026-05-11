import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng, step } from './helpers.js';
import { applyEventCard } from '../reserve/eventCards.js';

const noop = () => {};

test('cmty.callOptionBORR auto-resolves: buys 1 BORR at fixed $30', () => {
  const s = makeRoom(2);
  s.seats[0].cash = 1000;
  s.stocks.market.BORR.price = 75;
  applyEventCard(s, 0, 'community', 'cmty.callOptionBORR', { rng: makeRng() }, noop);
  assert.equal(s.seats[0].stockLots.BORR ?? 0, 1);
  assert.equal(s.seats[0].cash, 970);
  assert.equal(s.stocks.market.BORR.price, 75);
});

test('cmty.putOptionRRRD auto-resolves: sells 1 RRRD at fixed $50', () => {
  const s = makeRoom(2);
  s.seats[0].cash = 100;
  s.seats[0].stockLots = { RRRD: 1 };
  s.seats[0].stockCostBasis = { RRRD: 20 };
  s.stocks.market.RRRD.price = 12;
  applyEventCard(s, 0, 'community', 'cmty.putOptionRRRD', { rng: makeRng() }, noop);
  assert.equal(s.seats[0].stockLots.RRRD ?? 0, 0);
  assert.equal(s.seats[0].cash, 150);
  assert.equal(s.stocks.market.RRRD.price, 12);
});

test('cmty.analystUpgrade emits pendingCardChoice; chooseStockTarget bumps price by +10%', () => {
  const s = makeRoom(2);
  const before = s.stocks.market.TPHT.price;
  applyEventCard(s, 0, 'community', 'cmty.analystUpgrade', { rng: makeRng() }, noop);
  assert.ok(s.pendingCardChoice);
  assert.equal(s.pendingCardChoice.kind, 'stockUpgrade');
  assert.equal(s.pendingCardChoice.amount, 0.10);
  const next = step(s, { type: 'chooseStockTarget', seat: 0, symbol: 'TPHT' });
  assert.equal(next.stocks.market.TPHT.price, Math.round(before * 1.10 * 100) / 100);
  assert.equal(next.pendingCardChoice, null);
});

test('cmty.analystDowngrade applies -10%', () => {
  const s = makeRoom(2);
  const before = s.stocks.market.MNCL.price;
  applyEventCard(s, 0, 'community', 'cmty.analystDowngrade', { rng: makeRng() }, noop);
  const next = step(s, { type: 'chooseStockTarget', seat: 0, symbol: 'MNCL' });
  assert.equal(next.stocks.market.MNCL.price, Math.round(before * 0.90 * 100) / 100);
});

test('cmty.cousinBanker reduces chosen loan ptr by 1% (floored at 0)', () => {
  const s = makeRoom(2);
  s.seats[0].loans = [
    { id: 'L1', status: 'active', balance: 100, ptr: 0.05, term: 5, paymentsMade: 0, principal: 100, totalDebt: 125, installment: 25 }
  ];
  applyEventCard(s, 0, 'community', 'cmty.cousinBanker', { rng: makeRng() }, noop);
  assert.ok(s.pendingCardChoice);
  assert.equal(s.pendingCardChoice.kind, 'rateDiscount');
  const next = step(s, { type: 'chooseLoanTarget', seat: 0, loanId: 'L1' });
  assert.equal(next.seats[0].loans[0].ptr, 0.04);
  assert.equal(next.pendingCardChoice, null);
});

test('rateDiscount reduces remaining balance and installment, preserves cash already paid', () => {
  const s = makeRoom(2);
  s.seats[0].loans = [
    { id: 'L1', status: 'active', balance: 100, ptr: 0.05, term: 5, paymentsMade: 1,
      principal: 100, totalDebt: 125, installment: 25 }
  ];
  applyEventCard(s, 0, 'community', 'cmty.cousinBanker', { rng: makeRng() }, noop);
  const next = step(s, { type: 'chooseLoanTarget', seat: 0, loanId: 'L1' });
  const loan = next.seats[0].loans[0];
  assert.equal(loan.ptr, 0.04);
  assert.equal(loan.totalDebt, 120);
  assert.equal(loan.balance, 95);
  assert.equal(loan.installment, 23.75);
});

test('rateDiscount on a fresh loan reduces balance to the new totalDebt', () => {
  const s = makeRoom(2);
  s.seats[0].loans = [
    { id: 'L1', status: 'active', balance: 125, ptr: 0.05, term: 5, paymentsMade: 0,
      principal: 100, totalDebt: 125, installment: 25 }
  ];
  applyEventCard(s, 0, 'community', 'cmty.cousinBanker', { rng: makeRng() }, noop);
  const next = step(s, { type: 'chooseLoanTarget', seat: 0, loanId: 'L1' });
  const loan = next.seats[0].loans[0];
  assert.equal(loan.ptr, 0.04);
  assert.equal(loan.totalDebt, 120);
  assert.equal(loan.balance, 120);
  assert.equal(loan.installment, 24);
});

test('cmty.cousinBanker rejects if seat has no active loans', () => {
  const s = makeRoom(2);
  const r = applyEventCard(s, 0, 'community', 'cmty.cousinBanker', { rng: makeRng() }, noop);
  const eff = r.results.effects[0];
  assert.equal(eff.skipped, true);
  assert.equal(eff.reason, 'NO_ACTIVE_LOANS');
});

test('cmty.refinance rerolls loan ptr using current tier', () => {
  const s = makeRoom(2);
  s.seats[0].creditScore = 720;
  s.seats[0].loans = [
    { id: 'L1', status: 'active', balance: 100, ptr: 0.20, term: 5, paymentsMade: 0, principal: 100, totalDebt: 200, installment: 40 }
  ];
  applyEventCard(s, 0, 'community', 'cmty.refinance', { rng: makeRng() }, noop);
  assert.ok(s.pendingCardChoice);
  const next = step(s, { type: 'chooseLoanTarget', seat: 0, loanId: 'L1' }, { rng: () => 0.5 });
  assert.ok(next.seats[0].loans[0].ptr <= 0.16);
});

test('cmty.insiderTip reveals next card on chosen stock to that seat only', () => {
  const s = makeRoom(2);
  applyEventCard(s, 0, 'community', 'cmty.insiderTip', { rng: makeRng() }, noop);
  assert.ok(s.pendingCardChoice);
  assert.equal(s.pendingCardChoice.kind, 'insiderTip');
  const expectedReveal = s.stocks.market.TPHT.deck[0];
  const next = step(s, { type: 'chooseStockTarget', seat: 0, symbol: 'TPHT' });
  assert.equal(next.seats[0].revealedWildcards.TPHT, expectedReveal);
});

test('rollDice is blocked while pendingCardChoice is unresolved', () => {
  const s = makeRoom(2);
  s.turn = { seat: 0, phase: 'preRoll', lastRoll: null, doublesCount: 0 };
  s.pendingCardChoice = { seat: 0, kind: 'stockUpgrade', amount: 0.10, options: ['TPHT'] };
  const r = reducer(s, { type: 'rollDice', seat: 0 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'BLOCKED_BY_CARD_CHOICE');
});

test('endTurn is blocked while pendingCardChoice is unresolved', () => {
  const s = makeRoom(2);
  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s.pendingCardChoice = { seat: 0, kind: 'stockUpgrade', amount: 0.10, options: ['TPHT'] };
  const r = reducer(s, { type: 'endTurn', seat: 0 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'BLOCKED_BY_CARD_CHOICE');
});

test('skipCardChoice clears pendingCardChoice without effect', () => {
  const s = makeRoom(2);
  s.pendingCardChoice = { seat: 0, kind: 'stockUpgrade', amount: 0.10, options: ['TPHT'] };
  const next = step(s, { type: 'skipCardChoice', seat: 0 });
  assert.equal(next.pendingCardChoice, null);
});
