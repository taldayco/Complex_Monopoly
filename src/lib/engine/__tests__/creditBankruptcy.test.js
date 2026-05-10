import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng, giveProperty } from './helpers.js';
import { checkAndExecuteCreditBankruptcy } from '../bankruptcy.js';
import { BANKRUPTCY_FLOOR } from '../../shared/reserve/loanCatalog.js';

function step(state, action, ctx = { rng: makeRng() }) {
  const r = reducer(state, action, ctx);
  if (!r.ok) throw new Error('reducer error: ' + r.error);
  return r.state;
}

test('credit score above 350 → no auto-bankruptcy', () => {
  const room = makeRoom(2);
  room.seats[0].creditScore = 400;
  const r = checkAndExecuteCreditBankruptcy(room, 0);
  assert.equal(r, null);
  assert.equal(room.seats[0].bankrupt, false);
});

test('score < 350 with no debt → no liquidation, no elimination', () => {
  const room = makeRoom(2);
  room.seats[0].creditScore = 320;
  const r = checkAndExecuteCreditBankruptcy(room, 0);
  assert.equal(r.recovered, true);
  assert.equal(r.debtBefore, 0);
  assert.equal(room.seats[0].creditScore, BANKRUPTCY_FLOOR);
  assert.equal(room.seats[0].bankrupt, false);
});

test('score < 350 with stocks covering debt → seat continues with score reset to 350', () => {
  const room = makeRoom(2);
  room.seats[0].creditScore = 320;
  room.seats[0].cash = 0;
  room.seats[0].stockLots = { TPHT: 100 };
  room.stocks.market.TPHT.price = 5;
  room.seats[0].loans = [
    { id: 'L1', status: 'active', balance: 200, ptr: 0.05, term: 5, paymentsMade: 0, principal: 200, totalDebt: 250, installment: 50 }
  ];
  const r = checkAndExecuteCreditBankruptcy(room, 0);
  assert.equal(r.recovered, true);
  assert.equal(room.seats[0].bankrupt, false);
  assert.equal(room.seats[0].loans[0].status, 'closed');
  assert.equal(room.seats[0].loans[0].balance, 0);
  assert.equal(room.seats[0].creditScore, BANKRUPTCY_FLOOR);
});

test('score < 350 with insufficient assets → seat eliminated, marked bankrupt', () => {
  const room = makeRoom(3);
  room.seats[0].creditScore = 320;
  room.seats[0].cash = 0;
  room.seats[0].stockLots = {};
  room.seats[0].loans = [
    { id: 'L1', status: 'active', balance: 5000, ptr: 0.05, term: 5, paymentsMade: 0, principal: 5000, totalDebt: 5000, installment: 1000 }
  ];
  const r = checkAndExecuteCreditBankruptcy(room, 0);
  assert.equal(r.recovered, false);
  assert.equal(room.seats[0].bankrupt, true);
});

test('cash is NOT seized in credit bankruptcy (per spec)', () => {
  const room = makeRoom(2);
  room.seats[0].creditScore = 320;
  room.seats[0].cash = 1000;
  room.seats[0].stockLots = { TPHT: 100 };
  room.stocks.market.TPHT.price = 5;
  room.seats[0].loans = [
    { id: 'L1', status: 'active', balance: 200, ptr: 0.05, term: 5, paymentsMade: 0, principal: 200, totalDebt: 250, installment: 50 }
  ];
  const r = checkAndExecuteCreditBankruptcy(room, 0);
  assert.equal(r.recovered, true);
  assert.ok(room.seats[0].cash >= 1000);
});

test('liquidates undeveloped properties when stocks insufficient', () => {
  const room = makeRoom(2);
  room.seats[0].creditScore = 320;
  room.seats[0].cash = 0;
  room.seats[0].stockLots = {};
  giveProperty(room, 0, 39);
  room.seats[0].loans = [
    { id: 'L1', status: 'active', balance: 100, ptr: 0.05, term: 5, paymentsMade: 0, principal: 100, totalDebt: 100, installment: 20 }
  ];
  const r = checkAndExecuteCreditBankruptcy(room, 0);
  assert.equal(r.recovered, true);
  assert.equal(room.properties[39].ownerSeat, null);
});

test('reducer auto-checks for credit bankruptcy after every action', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 351;
  s.seats[0].cash = 0;
  s.seats[0].stockLots = {};
  s.seats[0].loans = [
    { id: 'L1', status: 'active', balance: 50, ptr: 0.05, term: 5, paymentsMade: 0, principal: 50, totalDebt: 50, installment: 10, dueThisTurn: true, creditCreditedThisTurn: false }
  ];
  s.seats[0].loanTurnResponded = false;
  s = step(s, { type: 'skipLoanInstallment', seat: 0, loanId: 'L1' });
  assert.equal(s.seats[0].bankrupt, true);
});
