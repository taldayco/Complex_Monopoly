import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng, step } from './helpers.js';
import { applyHysaInterestAtTurnStart, openAccount, deposit } from '../reserve/banking.js';
import { getHysaRateFor } from '../../shared/reserve/cardCatalog.js';

test('getHysaRateFor: returns the supplied base when no cards', () => {
  const seat = { creditCards: [] };
  assert.equal(getHysaRateFor(seat, 0.05), 0.05);
  assert.equal(getHysaRateFor(seat, 0), 0);
});

test('getHysaRateFor: stacks card bonuses additively on top of base', () => {
  const seat = {
    creditCards: [
      { id: 'a', cardId: 'readingRail', status: 'active' },
      { id: 'b', cardId: 'boardwalkPreferred', status: 'active' }
    ]
  };
  assert.equal(getHysaRateFor(seat, 0.05), 0.08);
});

test('applyHysaInterestAtTurnStart: pays into each open account at bank-derived rate', () => {
  const seat = makeSeatWithBoth(1000, 1000);
  const events = applyHysaInterestAtTurnStart(seat, 0.04);
  assert.equal(events.length, 2);
  assert.equal(seat.bankAccounts.mmcu.balance, 1030);
  assert.equal(seat.bankAccounts.boardwalk.balance, 1037.5);
});

test('applyHysaInterestAtTurnStart: floors at 0% when bank-derived rate is negative', () => {
  const seat = makeSeatWithBoth(1000, 1000);
  const events = applyHysaInterestAtTurnStart(seat, 0.005);
  assert.equal(seat.bankAccounts.mmcu.balance, 1000);
  assert.equal(seat.bankAccounts.boardwalk.balance, 1002.5);
  assert.equal(events.length, 1);
  assert.equal(events[0].bank, 'boardwalk');
});

test('applyHysaInterestAtTurnStart: card hysaBonus stacks on top of bank rate', () => {
  const seat = makeSeatWithBoth(1000, 0);
  seat.creditCards = [{ id: 'CC-rr', cardId: 'readingRail', status: 'active' }];
  applyHysaInterestAtTurnStart(seat, 0.03);
  assert.equal(seat.bankAccounts.mmcu.balance, 1030);
});

test('applyHysaInterestAtTurnStart: no interest into closed account or seat.cash', () => {
  const seat = makeSeatWithBoth(0, 0);
  seat.cash = 1000;
  applyHysaInterestAtTurnStart(seat, 0.04);
  assert.equal(seat.cash, 1000);
});

test('endTurn: HYSA accrues into open bank account, not seat.cash', () => {
  let s = makeRoom(2);
  s.economy.reserveRate = 0.04;
  openAccount(s.seats[1], 'mmcu');
  s.seats[1].cash = 1000;
  deposit(s.seats[1], 'mmcu', 1000);
  const cashBefore = s.seats[1].cash;

  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s = step(s, { type: 'endTurn', seat: 0 });

  assert.equal(s.turn.seat, 1);
  assert.equal(s.seats[1].cash, cashBefore);
  assert.ok(s.seats[1].bankAccounts.mmcu.balance > 1000);
});

test('endTurn: card hysaBonus stacks with bank rate at turn start', () => {
  let s = makeRoom(2);
  s.economy.reserveRate = 0.03;
  openAccount(s.seats[1], 'mmcu');
  s.seats[1].cash = 100;
  deposit(s.seats[1], 'mmcu', 100);
  s.seats[1].creditCards.push({
    id: 'CC-rr', cardId: 'readingRail', status: 'active', acquiredAt: 0, balance: 0
  });

  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s = step(s, { type: 'endTurn', seat: 0 });
  assert.ok(s.seats[1].bankAccounts.mmcu.balance > 100);
});

function makeSeatWithBoth(mmcuBalance, boardwalkBalance) {
  return {
    seat: 0,
    cash: 0,
    creditCards: [],
    loans: [],
    bankAccounts: {
      mmcu: { open: true, balance: mmcuBalance, openedAt: 0 },
      boardwalk: { open: true, balance: boardwalkBalance, openedAt: 0 }
    }
  };
}
