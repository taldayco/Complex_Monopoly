import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng, giveProperty } from './helpers.js';
import { applyHysaInterestAtTurnStart } from '../reserve/banking.js';
import { processCardCycle } from '../reserve/cards.js';
import { markLoansDueAtTurnStart } from '../reserve/loans.js';
import { markMortgageLoansDueAtTurnStart, requestMortgageLoan } from '../mortgage.js';
import { sendToJailWithSeizure, seizePropertyToBank } from '../jail.js';

function step(state, action, ctx = { rng: makeRng() }) {
  const r = reducer(state, action, ctx);
  if (!r.ok) throw new Error('reducer error: ' + r.error);
  return r.state;
}

test('jailed seat cannot buy stock', () => {
  let s = makeRoom(2);
  s.seats[0].inJail = true;
  const r = reducer(s, { type: 'buyStock', seat: 0, symbol: 'TPHT', qty: 1 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'JAILED');
});

test('jailed seat cannot sell stock', () => {
  let s = makeRoom(2);
  s.seats[0].inJail = true;
  const r = reducer(s, { type: 'sellStock', seat: 0, symbol: 'TPHT', qty: 1 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'JAILED');
});

test('jailed seat cannot request a loan', () => {
  let s = makeRoom(2);
  s.seats[0].inJail = true;
  s.seats[0].creditScore = 720;
  const r = reducer(s, { type: 'requestLoan', seat: 0, amount: 200 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'JAILED');
});

test('jailed seat cannot deposit/withdraw or wire transfer', () => {
  let s = makeRoom(2);
  s.seats[0].inJail = true;
  s.seats[0].bankAccounts.mmcu.open = true;
  const r1 = reducer(s, { type: 'depositToBank', seat: 0, bank: 'mmcu', amount: 100 }, { rng: makeRng() });
  assert.equal(r1.error, 'JAILED');
  const r2 = reducer(s, { type: 'withdrawFromBank', seat: 0, bank: 'mmcu', amount: 100 }, { rng: makeRng() });
  assert.equal(r2.error, 'JAILED');
  const r3 = reducer(s, { type: 'wireTransfer', seat: 0, toSeat: 1, amount: 100 }, { rng: makeRng() });
  assert.equal(r3.error, 'JAILED');
});

test('applyHysaInterestAtTurnStart skips jailed seats entirely', () => {
  const seat = {
    seat: 0,
    inJail: true,
    cash: 0,
    bankAccounts: {
      mmcu: { open: true, balance: 1000, openedAt: 0 },
      boardwalk: { open: false, balance: 0, openedAt: 0 }
    }
  };
  const events = applyHysaInterestAtTurnStart(seat, 0.10);
  assert.equal(events.length, 0);
  assert.equal(seat.bankAccounts.mmcu.balance, 1000);
});

test('processCardCycle skips jailed seats entirely', () => {
  const seat = {
    seat: 0,
    inJail: true,
    cash: 5000,
    creditScore: 720,
    creditCards: [{ id: 'CC-1', cardId: 'vaultPlatinum', status: 'active', balance: 500, openedAtTurn: 0, creditLine: 1200, autopay: true }]
  };
  const events = processCardCycle([seat], 4, 0);
  assert.equal(events.length, 0);
  assert.equal(seat.creditCards[0].balance, 500);
});

test('markLoansDueAtTurnStart skips jailed seats', () => {
  const seat = {
    seat: 0,
    inJail: true,
    loans: [{ id: 'L1', status: 'active', balance: 100, paymentsMade: 0, term: 3, dueThisTurn: false }],
    loanTurnResponded: false
  };
  const r = markLoansDueAtTurnStart(seat);
  assert.equal(r, false);
  assert.equal(seat.loans[0].dueThisTurn, false);
  assert.equal(seat.loanTurnResponded, true);
});

test('markMortgageLoansDueAtTurnStart skips jailed seats', () => {
  const seat = {
    seat: 0,
    inJail: true,
    mortgageLoans: [{ id: 'M1', status: 'active', balance: 100, paymentsMade: 0, term: 5, dueThisTurn: false }]
  };
  const r = markMortgageLoansDueAtTurnStart(seat);
  assert.equal(r, false);
  assert.equal(seat.mortgageLoans[0].dueThisTurn, false);
});

test('rent on owned property: jailed owner does NOT collect rent (goes to bank)', () => {
  let s = makeRoom(2);
  giveProperty(s, 1, 1);
  s.seats[1].inJail = true;
  s.seats[0].position = 39;
  const cashBeforeOwner = s.seats[1].cash;
  const cashBeforeLander = s.seats[0].cash;
  const rng = () => 0;
  s = step(s, { type: 'rollDice', seat: 0 }, { rng });
  assert.equal(s.seats[0].position, 1);
  assert.equal(s.seats[1].cash, cashBeforeOwner);
  assert.equal(s.seats[0].cash, cashBeforeLander + 100 - 2);
});

test('sendToJailWithSeizure: emits choices when seat owns properties', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1);
  giveProperty(room, 0, 3);
  const r = sendToJailWithSeizure(room, 0);
  assert.equal(r.jailed, true);
  assert.equal(r.seizureRequired, true);
  assert.deepEqual(r.choices.sort(), [1, 3]);
  assert.equal(room.seats[0].inJail, true);
  assert.deepEqual(room.pendingJailSeizureChoice.choices.sort(), [1, 3]);
});

test('sendToJailWithSeizure: no seizure required when seat owns nothing', () => {
  const room = makeRoom(2);
  const r = sendToJailWithSeizure(room, 0);
  assert.equal(r.jailed, true);
  assert.equal(r.seizureRequired, false);
  assert.equal(room.pendingJailSeizureChoice, null);
});

test('chooseJailSeizure: returns chosen property to bank and clears pending choice', () => {
  let s = makeRoom(2);
  giveProperty(s, 0, 1);
  giveProperty(s, 0, 3);
  sendToJailWithSeizure(s, 0);
  s = step(s, { type: 'chooseJailSeizure', seat: 0, spaceIndex: 1 });
  assert.equal(s.properties[1].ownerSeat, null);
  assert.equal(s.properties[3].ownerSeat, 0);
  assert.equal(s.pendingJailSeizureChoice, null);
});

test('chooseJailSeizure: rejects invalid choice', () => {
  let s = makeRoom(2);
  giveProperty(s, 0, 1);
  sendToJailWithSeizure(s, 0);
  const r = reducer(s, { type: 'chooseJailSeizure', seat: 0, spaceIndex: 5 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INVALID_CHOICE');
});

test('seizePropertyToBank clears mortgage and houses', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1, { mortgaged: true, houses: 0 });
  seizePropertyToBank(room, 0, 1);
  assert.equal(room.properties[1].ownerSeat, null);
  assert.equal(room.properties[1].mortgaged, false);
  assert.equal(room.properties[1].houses, 0);
});
