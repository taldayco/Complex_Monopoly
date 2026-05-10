import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng, giveProperty } from './helpers.js';
import {
  MORTGAGE_TIER_RATES,
  MORTGAGE_TERMS,
  MORTGAGE_MAX_DOWN_PAYMENT,
  MORTGAGE_PAYMENT_BONUS,
  MORTGAGE_MISSED_PENALTY,
  downPaymentDiscount,
  calcMortgageOffer,
  requestMortgageLoan,
  payMortgageInstallment,
  skipMortgageInstallment,
  payoffMortgageLoan
} from '../mortgage.js';
import { BOARD } from '../../shared/board.js';

function step(state, action, ctx = { rng: makeRng() }) {
  const r = reducer(state, action, ctx);
  if (!r.ok) throw new Error('reducer error: ' + r.error);
  return r.state;
}

test('MORTGAGE_TIER_RATES matches spec exactly for all tiers and terms', () => {
  assert.deepEqual(MORTGAGE_TIER_RATES.Excellent, { 5: 0.05, 10: 0.08 });
  assert.deepEqual(MORTGAGE_TIER_RATES['Very Good'], { 5: 0.08, 10: 0.10 });
  assert.deepEqual(MORTGAGE_TIER_RATES.Good, { 5: 0.10, 10: 0.12 });
  assert.deepEqual(MORTGAGE_TIER_RATES.Fair, { 5: 0.12, 10: 0.15 });
});

test('MORTGAGE_TERMS = [5, 10] and max down payment = 0.75', () => {
  assert.deepEqual(MORTGAGE_TERMS, [5, 10]);
  assert.equal(MORTGAGE_MAX_DOWN_PAYMENT, 0.75);
});

test('downPaymentDiscount: under 25% = 0%, 25-49% = -1%, 50-75% = -2%', () => {
  assert.equal(downPaymentDiscount(0), 0);
  assert.equal(downPaymentDiscount(0.10), 0);
  assert.equal(downPaymentDiscount(0.249), 0);
  assert.equal(downPaymentDiscount(0.25), 0.01);
  assert.equal(downPaymentDiscount(0.49), 0.01);
  assert.equal(downPaymentDiscount(0.50), 0.02);
  assert.equal(downPaymentDiscount(0.75), 0.02);
  assert.equal(downPaymentDiscount(-0.1), 0);
});

test('Poor/Very Poor tiers are not eligible for mortgage loans', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 39);
  room.seats[0].creditScore = 320;
  let r = calcMortgageOffer(room.seats[0], 39, 5, 0, room);
  assert.equal(r.ok, undefined);
  assert.equal(r.error, 'NOT_ELIGIBLE');
  room.seats[0].creditScore = 450;
  r = calcMortgageOffer(room.seats[0], 39, 5, 0, room);
  assert.equal(r.error, 'NOT_ELIGIBLE');
});

test('mortgage offer rejects bad term, bad down payment, and unowned property', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 39);
  room.seats[0].creditScore = 720;
  assert.equal(calcMortgageOffer(room.seats[0], 39, 7, 0, room).error, 'BAD_TERM');
  assert.equal(calcMortgageOffer(room.seats[0], 39, 5, 0.8, room).error, 'BAD_DOWN_PAYMENT');
  assert.equal(calcMortgageOffer(room.seats[0], 39, 5, -0.1, room).error, 'BAD_DOWN_PAYMENT');
  giveProperty(room, 1, 37);
  assert.equal(calcMortgageOffer(room.seats[0], 37, 5, 0, room).error, 'NOT_OWNER');
});

test('mortgage offer rejects already-mortgaged or developed property', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 39, { mortgaged: true });
  room.seats[0].creditScore = 720;
  assert.equal(calcMortgageOffer(room.seats[0], 39, 5, 0, room).error, 'ALREADY_MORTGAGED');
  giveProperty(room, 0, 37, { houses: 1 });
  assert.equal(calcMortgageOffer(room.seats[0], 37, 5, 0, room).error, 'HAS_HOUSES');
});

test('mortgage offer for Good tier, term 5, no down: principal = mortgageValue, rate = 10%', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 39);
  room.seats[0].creditScore = 720;
  const space = BOARD[39];
  const offer = calcMortgageOffer(room.seats[0], 39, 5, 0, room);
  assert.equal(offer.ok, true);
  assert.equal(offer.tier, 'Good');
  assert.equal(offer.ptr, 0.10);
  assert.equal(offer.principal, space.mortgageValue);
  assert.equal(offer.term, 5);
});

test('mortgage offer with 25% down: -1% rate; principal scaled by (1 - dp)', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 39);
  room.seats[0].creditScore = 720;
  const space = BOARD[39];
  const offer = calcMortgageOffer(room.seats[0], 39, 5, 0.25, room);
  assert.equal(offer.ptr, 0.09);
  assert.equal(offer.principal, Math.round(space.mortgageValue * 0.75 * 100) / 100);
});

test('mortgage offer with 50% down: -2% rate', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 39);
  room.seats[0].creditScore = 720;
  const offer = calcMortgageOffer(room.seats[0], 39, 5, 0.50, room);
  assert.equal(offer.ptr, 0.08);
});

test('mortgage offer with reserveRate added: rate floors at 0', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 39);
  room.seats[0].creditScore = 800;
  room.economy.reserveRate = -0.15;
  const offer = calcMortgageOffer(room.seats[0], 39, 5, 0.5, room, { reserveRate: -0.15 });
  assert.equal(offer.ptr, 0);
});

test('requestMortgageLoan: creates loan, advances cash, marks property mortgaged', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 39);
  room.seats[0].creditScore = 720;
  const cashBefore = room.seats[0].cash;
  const space = BOARD[39];
  const r = requestMortgageLoan(room, 0, 39, 5, 0);
  assert.equal(r.ok, true);
  assert.equal(room.seats[0].cash, Math.round((cashBefore + space.mortgageValue) * 100) / 100);
  assert.equal(room.properties[39].mortgaged, true);
  assert.equal(room.seats[0].mortgageLoans.length, 1);
  const loan = room.seats[0].mortgageLoans[0];
  assert.equal(loan.propertyIndex, 39);
  assert.equal(loan.status, 'active');
  assert.equal(loan.balance, loan.totalDebt);
});

test('payMortgageInstallment on time grants +1 credit, anti-hack capped per turn per loan', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 39);
  room.seats[0].creditScore = 720;
  room.seats[0].cash = 5000;
  requestMortgageLoan(room, 0, 39, 5, 0);
  const loan = room.seats[0].mortgageLoans[0];
  loan.dueThisTurn = true;
  const before = room.seats[0].creditScore;
  payMortgageInstallment(room, 0, loan.id);
  assert.equal(room.seats[0].creditScore, before + MORTGAGE_PAYMENT_BONUS);
  assert.equal(loan.creditCreditedThisTurn, true);
  loan.dueThisTurn = true;
  const r2 = payMortgageInstallment(room, 0, loan.id);
  assert.equal(r2.ok, true);
  assert.equal(room.seats[0].creditScore, before + MORTGAGE_PAYMENT_BONUS);
});

test('skipMortgageInstallment penalizes -1 credit', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 39);
  room.seats[0].creditScore = 720;
  requestMortgageLoan(room, 0, 39, 5, 0);
  const loan = room.seats[0].mortgageLoans[0];
  loan.dueThisTurn = true;
  const before = room.seats[0].creditScore;
  skipMortgageInstallment(room, 0, loan.id);
  assert.equal(room.seats[0].creditScore, before - MORTGAGE_MISSED_PENALTY);
});

test('payoffMortgageLoan clears balance and unmortgages the property', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 39);
  room.seats[0].creditScore = 720;
  room.seats[0].cash = 5000;
  requestMortgageLoan(room, 0, 39, 5, 0);
  const loan = room.seats[0].mortgageLoans[0];
  payoffMortgageLoan(room, 0, loan.id);
  assert.equal(loan.status, 'closed');
  assert.equal(loan.balance, 0);
  assert.equal(room.properties[39].mortgaged, false);
});

test('full installment cycle closes loan and unmortgages property', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 39);
  room.seats[0].creditScore = 720;
  room.seats[0].cash = 5000;
  requestMortgageLoan(room, 0, 39, 5, 0);
  const loan = room.seats[0].mortgageLoans[0];
  for (let i = 0; i < 5; i++) {
    loan.dueThisTurn = true;
    loan.creditCreditedThisTurn = false;
    const r = payMortgageInstallment(room, 0, loan.id);
    assert.equal(r.ok, true);
  }
  assert.equal(loan.status, 'closed');
  assert.equal(room.properties[39].mortgaged, false);
});

test('reducer requestMortgageLoan action plumbs through', () => {
  let s = makeRoom(2);
  giveProperty(s, 0, 39);
  s.seats[0].creditScore = 720;
  s = step(s, { type: 'requestMortgageLoan', seat: 0, spaceIndex: 39, term: 5, downPaymentPct: 0 });
  assert.equal(s.seats[0].mortgageLoans.length, 1);
  assert.equal(s.properties[39].mortgaged, true);
});

test('mortgage offer exposes downPaymentAmount = mortgageValue × downPaymentPct', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 39);
  room.seats[0].creditScore = 720;
  const space = BOARD[39];
  const o0 = calcMortgageOffer(room.seats[0], 39, 5, 0, room);
  assert.equal(o0.downPaymentAmount, 0);
  const o25 = calcMortgageOffer(room.seats[0], 39, 5, 0.25, room);
  assert.equal(o25.downPaymentAmount, Math.round(space.mortgageValue * 0.25 * 100) / 100);
  const o50 = calcMortgageOffer(room.seats[0], 39, 5, 0.50, room);
  assert.equal(o50.downPaymentAmount, Math.round(space.mortgageValue * 0.50 * 100) / 100);
});

test('requestMortgageLoan with down payment debits the down payment from cash', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 39);
  room.seats[0].creditScore = 720;
  const cashBefore = room.seats[0].cash;
  const space = BOARD[39];
  const r = requestMortgageLoan(room, 0, 39, 5, 0.25);
  assert.equal(r.ok, true);
  const dp = Math.round(space.mortgageValue * 0.25 * 100) / 100;
  const principal = Math.round(space.mortgageValue * 0.75 * 100) / 100;
  assert.equal(room.seats[0].cash, Math.round((cashBefore + principal - dp) * 100) / 100);
  assert.equal(room.seats[0].mortgageLoans[0].downPaymentAmount, dp);
});

test('calcMortgageOffer rejects when seat cannot afford the down payment', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 39);
  room.seats[0].creditScore = 720;
  const space = BOARD[39];
  room.seats[0].cash = Math.round(space.mortgageValue * 0.25 * 100) / 100 - 1;
  const r = calcMortgageOffer(room.seats[0], 39, 5, 0.25, room);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS_FOR_DOWN_PAYMENT');
});

test('requestMortgageLoan rejects when seat cannot afford the down payment', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 39);
  room.seats[0].creditScore = 720;
  room.seats[0].cash = 1;
  const r = requestMortgageLoan(room, 0, 39, 5, 0.50);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS_FOR_DOWN_PAYMENT');
  assert.equal(room.seats[0].mortgageLoans?.length ?? 0, 0);
  assert.equal(room.properties[39].mortgaged, false);
});

test('rollDice is blocked while a mortgage installment is due (mortgageTurnResponded=false)', () => {
  let s = makeRoom(2);
  s.turn = { seat: 0, phase: 'preRoll', lastRoll: null, doublesCount: 0 };
  s.seats[0].mortgageTurnResponded = false;
  const r = reducer(s, { type: 'rollDice', seat: 0 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'MORTGAGE_DUE');
});
