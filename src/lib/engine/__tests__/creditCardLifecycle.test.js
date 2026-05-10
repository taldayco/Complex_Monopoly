import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng } from './helpers.js';
import {
  applyForCard,
  requestCreditLineIncrease,
  processCardCycle,
  payCardBalance
} from '../reserve/cards.js';
import {
  calcCreditLine,
  utilizationDelta,
  getCardBankCode,
  CREDIT_LINE_INCREASE_PENALTY,
  UTILIZATION_BUCKETS
} from '../../shared/reserve/cardCatalog.js';

function step(state, action, ctx = { rng: makeRng() }) {
  const r = reducer(state, action, ctx);
  if (!r.ok) throw new Error('reducer error: ' + r.error);
  return r.state;
}

test('calcCreditLine: dynamic formula with $10 rounding, floored at minLine', () => {
  const seat = { cash: 1000, creditScore: 720 };
  assert.equal(calcCreditLine(seat, 'goRewards'), 1750);
});

test('calcCreditLine: floors at card.minLine when dynamic is too low', () => {
  const seat = { cash: 50, creditScore: 720 };
  assert.equal(calcCreditLine(seat, 'goRewards'), 400);
});

test('calcCreditLine: Very Poor and Poor return minLine (mult 0)', () => {
  assert.equal(calcCreditLine({ cash: 1000, creditScore: 320 }, 'goRewards'), 400);
  assert.equal(calcCreditLine({ cash: 1000, creditScore: 450 }, 'readingRail'), 200);
});

test('calcCreditLine: includes bank balances and subtracts loan balances', () => {
  const seat = {
    cash: 500,
    creditScore: 720,
    bankAccounts: { mmcu: { open: true, balance: 500 }, boardwalk: { open: false, balance: 0 } },
    loans: [{ status: 'active', balance: 200 }]
  };
  assert.equal(calcCreditLine(seat, 'portfolioGold'), 1400);
});

test('utilizationDelta buckets: <30% = +5, 30-49% = 0, 50-74% = -5, 75-100% = -10', () => {
  assert.equal(utilizationDelta(0), 5);
  assert.equal(utilizationDelta(0.10), 5);
  assert.equal(utilizationDelta(0.29), 5);
  assert.equal(utilizationDelta(0.30), 0);
  assert.equal(utilizationDelta(0.49), 0);
  assert.equal(utilizationDelta(0.50), -5);
  assert.equal(utilizationDelta(0.74), -5);
  assert.equal(utilizationDelta(0.75), -10);
  assert.equal(utilizationDelta(1.00), -10);
});

test('getCardBankCode normalizes display names to codes', () => {
  assert.equal(getCardBankCode('readingRail'), 'mmcu');
  assert.equal(getCardBankCode('vaultPlatinum'), 'boardwalk');
});

test('applyForCard: per-bank uniqueness rejects second card from same bank', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 800;
  s = step(s, { type: 'requestCreditCard', seat: 0, cardId: 'vaultPlatinum' });
  const r = reducer(s, { type: 'requestCreditCard', seat: 0, cardId: 'primeAdvantage' }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'BANK_LIMIT_REACHED');
});

test('applyForCard: allows one card per bank (MMCU + Boardwalk together)', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 800;
  s = step(s, { type: 'requestCreditCard', seat: 0, cardId: 'goRewards' });
  s = step(s, { type: 'requestCreditCard', seat: 0, cardId: 'vaultPlatinum' });
  assert.equal(s.seats[0].creditCards.length, 2);
});

test('applyForCard: stores creditLine, openedAtTurn, autopay=true', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 720;
  s.turnCount = 7;
  s = step(s, { type: 'requestCreditCard', seat: 0, cardId: 'goRewards' });
  const c = s.seats[0].creditCards[0];
  assert.equal(typeof c.creditLine, 'number');
  assert.ok(c.creditLine > 0);
  assert.equal(c.openedAtTurn, 7);
  assert.equal(c.autopay, true);
});

test('requestCreditLineIncrease: -25 credit always; line raised only if formula > old', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 720;
  s = step(s, { type: 'requestCreditCard', seat: 0, cardId: 'goRewards' });
  const inst = s.seats[0].creditCards[0];
  const before = s.seats[0].creditScore;
  const beforeLine = inst.creditLine;
  s.seats[0].cash += 5000;
  s = step(s, { type: 'requestCreditLineIncrease', seat: 0, instanceId: inst.id });
  assert.equal(s.seats[0].creditScore, before - CREDIT_LINE_INCREASE_PENALTY);
  assert.ok(s.seats[0].creditCards[0].creditLine > beforeLine);
});

test('requestCreditLineIncrease: -25 credit even when line is unchanged', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 720;
  s.seats[0].cash = 0;
  s = step(s, { type: 'requestCreditCard', seat: 0, cardId: 'goRewards' });
  const inst = s.seats[0].creditCards[0];
  const before = s.seats[0].creditScore;
  const beforeLine = inst.creditLine;
  s = step(s, { type: 'requestCreditLineIncrease', seat: 0, instanceId: inst.id });
  assert.equal(s.seats[0].creditScore, before - CREDIT_LINE_INCREASE_PENALTY);
  assert.equal(s.seats[0].creditCards[0].creditLine, beforeLine);
});

test('processCardCycle: per-card timing fires at openedAtTurn + 4, 8, 12', () => {
  const seat = {
    seat: 0,
    cash: 1000,
    creditScore: 720,
    creditCards: [{
      id: 'CC-1',
      cardId: 'vaultPlatinum',
      status: 'active',
      balance: 200,
      openedAtTurn: 1,
      creditLine: 1200,
      autopay: true
    }]
  };
  const seats = [seat];
  assert.equal(processCardCycle(seats, 4, 0).length, 0);
  assert.equal(processCardCycle(seats, 5, 0).length, 1);
  seat.creditCards[0].balance = 200;
  assert.equal(processCardCycle(seats, 9, 0).length, 1);
});

test('processCardCycle: autopay debits minPayment, balance reduces, then interest accrues', () => {
  const seat = {
    seat: 0,
    cash: 1500,
    creditScore: 720,
    creditCards: [{
      id: 'CC-1',
      cardId: 'vaultPlatinum',
      status: 'active',
      balance: 500,
      openedAtTurn: 0,
      creditLine: 1200,
      autopay: true
    }]
  };
  const events = processCardCycle([seat], 4, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].paid, 100);
  assert.equal(events[0].missed, false);
  assert.equal(seat.cash, 1400);
  assert.equal(seat.creditCards[0].balance, 480);
});

test('processCardCycle: missed payment when cash insufficient applies card-specific penalty', () => {
  const seat = {
    seat: 0,
    cash: 0,
    creditScore: 720,
    creditCards: [{
      id: 'CC-1',
      cardId: 'goRewards',
      status: 'active',
      balance: 200,
      openedAtTurn: 0,
      creditLine: 400,
      autopay: true
    }]
  };
  const events = processCardCycle([seat], 4, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].missed, true);
  assert.equal(seat.creditScore, 720 - 10);
});

test('processCardCycle: utilization scoring at payment time, +5 when low utilization', () => {
  const seat = {
    seat: 0,
    cash: 5000,
    creditScore: 720,
    creditCards: [{
      id: 'CC-1',
      cardId: 'vaultPlatinum',
      status: 'active',
      balance: 200,
      openedAtTurn: 0,
      creditLine: 1200,
      autopay: true
    }]
  };
  const before = seat.creditScore;
  processCardCycle([seat], 4, 0);
  assert.equal(seat.creditScore, before + 5);
});

test('processCardCycle: utilization 75%+ reduces credit -10', () => {
  const seat = {
    seat: 0,
    cash: 5000,
    creditScore: 720,
    creditCards: [{
      id: 'CC-1',
      cardId: 'vaultPlatinum',
      status: 'active',
      balance: 1000,
      openedAtTurn: 0,
      creditLine: 1200,
      autopay: true
    }]
  };
  const before = seat.creditScore;
  processCardCycle([seat], 4, 0);
  assert.equal(seat.creditScore, before - 10);
});

test('processCardCycle: Vault Platinum missed-payment penalty is -5 instead of -10', () => {
  const seat = {
    seat: 0,
    cash: 0,
    creditScore: 720,
    creditCards: [{
      id: 'CC-1',
      cardId: 'vaultPlatinum',
      status: 'active',
      balance: 200,
      openedAtTurn: 0,
      creditLine: 1200,
      autopay: true
    }]
  };
  processCardCycle([seat], 4, 0);
  assert.equal(seat.creditScore, 720 - 5);
});

test('reducer requestCreditLineIncrease action plumbs through', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 720;
  s = step(s, { type: 'requestCreditCard', seat: 0, cardId: 'goRewards' });
  const inst = s.seats[0].creditCards[0];
  const before = s.seats[0].creditScore;
  s = step(s, { type: 'requestCreditLineIncrease', seat: 0, instanceId: inst.id });
  assert.equal(s.seats[0].creditScore, before - CREDIT_LINE_INCREASE_PENALTY);
});
