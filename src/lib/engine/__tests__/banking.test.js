import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng, step } from './helpers.js';
import {
  openAccount,
  closeAccount,
  deposit,
  withdraw,
  applyHysaInterestAtTurnStart,
  eligibleForBoardwalkDiscount,
  applyFdicDisaster,
  ensureSeatBankAccounts
} from '../reserve/banking.js';
import { BANKS } from '../../shared/reserve/economyCatalog.js';

function freshSeat(cash = 0) {
  const s = {
    seat: 0,
    cash,
    creditCards: [],
    loans: []
  };
  ensureSeatBankAccounts(s);
  return s;
}


test('openAccount: opens, rejects duplicate, rejects unknown bank', () => {
  const s = freshSeat();
  assert.equal(openAccount(s, 'mmcu').ok, true);
  assert.equal(s.bankAccounts.mmcu.open, true);
  assert.equal(openAccount(s, 'mmcu').error, 'ALREADY_OPEN');
  assert.equal(openAccount(s, 'fakebank').error, 'UNKNOWN_BANK');
});

test('closeAccount: rejects when balance > 0 OR active loan/card at that bank', () => {
  const s = freshSeat(1000);
  openAccount(s, 'boardwalk');
  deposit(s, 'boardwalk', 500);
  assert.equal(closeAccount(s, 'boardwalk').error, 'OUTSTANDING_BALANCE');

  withdraw(s, 'boardwalk', 500);
  s.loans.push({ id: 'L', bank: 'boardwalk', status: 'active' });
  assert.equal(closeAccount(s, 'boardwalk').error, 'ACTIVE_LOAN');

  s.loans = [];
  s.creditCards.push({ id: 'C', cardId: 'boardwalkPreferred', status: 'active' });
  assert.equal(closeAccount(s, 'boardwalk').error, 'ACTIVE_CARD');

  s.creditCards = [];
  assert.equal(closeAccount(s, 'boardwalk').ok, true);
  assert.equal(s.bankAccounts.boardwalk.open, false);
});


test('deposit moves cash into the open account', () => {
  const s = freshSeat(1000);
  openAccount(s, 'mmcu');
  const r = deposit(s, 'mmcu', 250);
  assert.equal(r.ok, true);
  assert.equal(s.cash, 750);
  assert.equal(s.bankAccounts.mmcu.balance, 250);
});

test('withdraw enforces per-bank cap', () => {
  const s = freshSeat(0);
  openAccount(s, 'mmcu');
  s.bankAccounts.mmcu.balance = 5000;
  const r = withdraw(s, 'mmcu', BANKS.mmcu.maxWithdrawal + 1);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'EXCEEDS_WITHDRAWAL_CAP');
  const r2 = withdraw(s, 'mmcu', BANKS.mmcu.maxWithdrawal);
  assert.equal(r2.ok, true);
  assert.equal(s.cash, BANKS.mmcu.maxWithdrawal);
});

test('Boardwalk has a higher withdrawal cap than MMCU', () => {
  assert.ok(BANKS.boardwalk.maxWithdrawal > BANKS.mmcu.maxWithdrawal);
  const s = freshSeat(0);
  openAccount(s, 'boardwalk');
  s.bankAccounts.boardwalk.balance = 50000;
  const r = withdraw(s, 'boardwalk', BANKS.boardwalk.maxWithdrawal);
  assert.equal(r.ok, true);
});

test('deposit rejects on closed account; withdraw rejects on insufficient balance', () => {
  const s = freshSeat(100);
  assert.equal(deposit(s, 'mmcu', 50).error, 'NOT_OPEN');
  openAccount(s, 'mmcu');
  assert.equal(withdraw(s, 'mmcu', 50).error, 'INSUFFICIENT_BALANCE');
});


test('applyHysaInterestAtTurnStart: per-bank rate from depositBeta, floored at 0%', () => {
  const s = freshSeat(0);
  openAccount(s, 'mmcu');
  openAccount(s, 'boardwalk');
  s.bankAccounts.mmcu.balance = 1000;
  s.bankAccounts.boardwalk.balance = 1000;
  applyHysaInterestAtTurnStart(s, 0.04);
  assert.equal(s.bankAccounts.mmcu.balance, 1016);
  assert.equal(s.bankAccounts.boardwalk.balance, 1024);
  s.bankAccounts.mmcu.balance = 1000;
  s.bankAccounts.boardwalk.balance = 1000;
  applyHysaInterestAtTurnStart(s, 0);
  assert.equal(s.bankAccounts.mmcu.balance, 1000);
  assert.equal(s.bankAccounts.boardwalk.balance, 1000);
});

test('applyHysaInterestAtTurnStart: skips closed accounts and zero balances', () => {
  const s = freshSeat(0);
  openAccount(s, 'mmcu');
  const events = applyHysaInterestAtTurnStart(s, 0.05);
  assert.equal(events.length, 0);
});


test('eligibleForBoardwalkDiscount: true with no MM activity', () => {
  const s = freshSeat();
  assert.equal(eligibleForBoardwalkDiscount(s), true);
});

test('eligibleForBoardwalkDiscount: false when seat has an active MM loan', () => {
  const s = freshSeat();
  s.loans = [{ id: 'L', bank: 'mmcu', status: 'active' }];
  assert.equal(eligibleForBoardwalkDiscount(s), false);
});

test('eligibleForBoardwalkDiscount: false when seat has an active MM credit card', () => {
  const s = freshSeat();
  s.creditCards = [{ id: 'C', cardId: 'readingRail', status: 'active' }];
  assert.equal(eligibleForBoardwalkDiscount(s), false);
});

test('eligibleForBoardwalkDiscount: still true with an active Boardwalk loan / card', () => {
  const s = freshSeat();
  s.loans = [{ id: 'L', bank: 'boardwalk', status: 'active' }];
  s.creditCards = [{ id: 'C', cardId: 'boardwalkPreferred', status: 'active' }];
  assert.equal(eligibleForBoardwalkDiscount(s), true);
});


test('applyFdicDisaster: clamps every open account at the FDIC cap, leaves cash alone', () => {
  const seats = [
    { seat: 0, cash: 200, bankAccounts: { mmcu: { open: true, balance: 8000 }, boardwalk: { open: true, balance: 3000 } } },
    { seat: 1, cash: 0,   bankAccounts: { mmcu: { open: false, balance: 0 },   boardwalk: { open: true, balance: 12000 } } }
  ];
  const r = applyFdicDisaster(seats);
  assert.equal(seats[0].bankAccounts.mmcu.balance, 5000);
  assert.equal(seats[0].bankAccounts.boardwalk.balance, 3000);
  assert.equal(seats[1].bankAccounts.mmcu.balance, 0);
  assert.equal(seats[1].bankAccounts.boardwalk.balance, 5000);
  assert.equal(seats[0].cash, 200);
  assert.equal(seats[1].cash, 0);
  assert.equal(r.losses.length, 2);
});


test('reducer: full open → deposit → withdraw → close roundtrip', () => {
  let s = makeRoom(2);
  s.seats[0].cash = 5000;
  s = step(s, { type: 'openBankAccount', seat: 0, bank: 'mmcu' });
  assert.equal(s.seats[0].bankAccounts.mmcu.open, true);
  s = step(s, { type: 'depositToBank', seat: 0, bank: 'mmcu', amount: 1000 });
  assert.equal(s.seats[0].cash, 4000);
  assert.equal(s.seats[0].bankAccounts.mmcu.balance, 1000);
  s = step(s, { type: 'withdrawFromBank', seat: 0, bank: 'mmcu', amount: 1000 });
  assert.equal(s.seats[0].cash, 5000);
  assert.equal(s.seats[0].bankAccounts.mmcu.balance, 0);
  s = step(s, { type: 'closeBankAccount', seat: 0, bank: 'mmcu' });
  assert.equal(s.seats[0].bankAccounts.mmcu.open, false);
});

test('reducer: deposit blocked while a banking action is rejected during rollOff', () => {
  let s = makeRoom(2);
  s.phase = 'rollOff';
  s.rollOff = { contenders: [0, 1], rolls: {}, settledOrder: [], round: 1 };
  const r = reducer(s, { type: 'depositToBank', seat: 0, bank: 'mmcu', amount: 100 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NOT_PLAYING');
});
