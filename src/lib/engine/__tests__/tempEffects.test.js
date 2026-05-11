import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, makeRng } from './helpers.js';
import { applyEventCard } from '../reserve/eventCards.js';
import { requestLoanOffer, acceptLoanOffer } from '../reserve/loans.js';
import { applyTurnStartCardFees, applyForCard } from '../reserve/cards.js';
import { calcMaxStandardLoan, effectiveTier } from '../../shared/reserve/loanCatalog.js';
import { canBuyHouse, buyHouse, calcPermitFees } from '../building.js';
import { giveProperty } from './helpers.js';

const noop = () => {};

test('effectiveTier without tempEffects returns base tier', () => {
  const seat = { creditScore: 720, tempEffects: [] };
  assert.equal(effectiveTier(seat).name, 'Good');
});

test('effectiveTier with tierBoost +1 promotes tier', () => {
  const seat = {
    creditScore: 720,
    tempEffects: [{ effectId: 'tierBoost', expiresInTurns: 3, payload: { tiers: 1 } }]
  };
  assert.equal(effectiveTier(seat).name, 'Very Good');
});

test('effectiveTier with tierBoost +5 clamps at Excellent', () => {
  const seat = {
    creditScore: 590,
    tempEffects: [{ effectId: 'tierBoost', expiresInTurns: 3, payload: { tiers: 5 } }]
  };
  assert.equal(effectiveTier(seat).name, 'Excellent');
});

test('doubleMaxLine doubles calcMaxStandardLoan output', () => {
  const seat = { creditScore: 720, cash: 1000, bankAccounts: {}, loans: [], mortgageLoans: [], tempEffects: [] };
  const baseLine = calcMaxStandardLoan(seat);
  seat.tempEffects = [{ effectId: 'doubleMaxLine', expiresInTurns: 3 }];
  const room = makeRoom(2);
  room.seats[0] = { ...room.seats[0], ...seat, seat: 0, pendingLoanOffer: null, standardLoansThisTurn: 0 };
  const r = requestLoanOffer(room.seats[0], baseLine + 1, 1, { reserveRate: 0 });
  assert.equal(r.ok, true);
  assert.ok(r.offer.maxLine >= baseLine * 2 - 100);
});

test('maxLoanHalved halves the line', () => {
  const room = makeRoom(2);
  room.seats[0].creditScore = 720;
  room.seats[0].cash = 1000;
  room.seats[0].tempEffects = [{ effectId: 'maxLoanHalved', expiresInTurns: 1 }];
  room.seats[0].standardLoansThisTurn = 0;
  const r = requestLoanOffer(room.seats[0], 100, 1, { reserveRate: 0 });
  assert.equal(r.ok, true);
  const baseLine = calcMaxStandardLoan({ ...room.seats[0], tempEffects: [] });
  assert.ok(r.offer.maxLine <= baseLine * 0.5 + 100);
});

test('fairCreditBlocked blocks Fair-tier requests', () => {
  const room = makeRoom(2);
  room.seats[0].creditScore = 600;
  room.seats[0].cash = 1000;
  room.seats[0].tempEffects = [{ effectId: 'fairCreditBlocked', expiresInTurns: 1 }];
  room.seats[0].standardLoansThisTurn = 0;
  const r = requestLoanOffer(room.seats[0], 100, 1, { reserveRate: 0 });
  assert.equal(r.error, 'CREDIT_CRUNCH_BLOCKED');
});

test('fairCreditBlocked does not block Good-tier requests', () => {
  const room = makeRoom(2);
  room.seats[0].creditScore = 720;
  room.seats[0].cash = 1000;
  room.seats[0].tempEffects = [{ effectId: 'fairCreditBlocked', expiresInTurns: 1 }];
  room.seats[0].standardLoansThisTurn = 0;
  const r = requestLoanOffer(room.seats[0], 100, 1, { reserveRate: 0 });
  assert.equal(r.ok, true);
});

test('halfCardFees halves rotating-fee debit', () => {
  const seat = {
    seat: 0,
    cash: 1000,
    creditScore: 720,
    tempEffects: [{ effectId: 'halfCardFees', expiresInTurns: 5 }],
    creditCards: [{
      id: 'CC-test',
      cardId: 'readingRail',
      status: 'active',
      balance: 0
    }]
  };
  const fakeCardCatalog = { readingRail: { rotatingFee: 100 } };
  const events = [];
  for (const inst of seat.creditCards) {
    const card = fakeCardCatalog[inst.cardId];
    const baseFee = card.rotatingFee;
    const halfFees = seat.tempEffects.some((e) => e.effectId === 'halfCardFees');
    const fee = halfFees ? Math.round(baseFee * 50) / 100 : baseFee;
    assert.equal(fee, 50);
    events.push({ fee });
  }
  assert.equal(events[0].fee, 50);
});

test('zeroInterestNextLoan zeroes ptr on the next offer and is consumed on accept', () => {
  const room = makeRoom(2);
  room.seats[0].creditScore = 720;
  room.seats[0].cash = 1000;
  room.seats[0].tempEffects = [{ effectId: 'zeroInterestNextLoan', expiresInTurns: 3 }];
  room.seats[0].standardLoansThisTurn = 0;
  const r = requestLoanOffer(room.seats[0], 500, 1, { reserveRate: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.offer.zeroInterestApplied, true);
  for (const o of r.offer.options) assert.equal(o.ptr, 0);
  acceptLoanOffer(room.seats[0], 5);
  assert.equal(room.seats[0].tempEffects.length, 0);
});

test('nextDevModifier reduces dev cost by amount and is consumed after buyHouse', () => {
  const s = makeRoom(2);
  giveProperty(s, 0, 1);
  s.seats[0].cash = 5000;
  s.seats[0].nextDevModifier = { amount: -0.25 };
  const before = s.seats[0].cash;
  const r = canBuyHouse(s, 0, 1);
  assert.equal(r.ok, true);
  assert.equal(r.cost, 37.5);
  buyHouse(s, 0, 1);
  assert.equal(s.seats[0].cash, before - 37.5);
  assert.equal(s.seats[0].nextDevModifier, null);
});

test('nextPermitFeeModifier reduces permit fees and is consumed after buyHouse', () => {
  const s = makeRoom(3);
  giveProperty(s, 0, 1);
  giveProperty(s, 1, 3);
  s.seats[0].cash = 5000;
  s.seats[0].nextPermitFeeModifier = { amount: -0.5 };
  const fees = calcPermitFees(s, 0, 1, 50);
  assert.equal(fees.feePerProperty, 6.25);
  buyHouse(s, 0, 1);
  assert.equal(s.seats[0].nextPermitFeeModifier, null);
});
