import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng } from './helpers.js';
import {
  getMaxLineFor,
  getMissedPaymentPenalty,
  getPtrDiscountFor,
  meetsTierRequirement
} from '../../shared/reserve/cardCatalog.js';

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

test('getMaxLineFor applies card bonuses multiplicatively', () => {
  const seat = { creditScore: 800, creditCards: [
    { id: 'b', cardId: 'boardwalkPreferred', status: 'active' }  // +40%
  ]};
  // Excellent base = 1000; *1.4 = 1400
  assert.equal(getMaxLineFor(seat), 1400);
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

test('requestCreditCard: rejects duplicate active card', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 800;
  s = step(s, { type: 'requestCreditCard', seat: 0, cardId: 'vaultPlatinum' });
  const r = reducer(s, { type: 'requestCreditCard', seat: 0, cardId: 'vaultPlatinum' }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'ALREADY_OWNED');
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
  s.seats[0].creditScore = 750; // Very Good → base $500
  // Without the card $600 should be over-limit.
  let r = reducer(s, { type: 'requestLoan', seat: 0, amount: 600 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'OVER_MAX_LINE');
  // Add Boardwalk Preferred (+40%) → max line becomes $700.
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
