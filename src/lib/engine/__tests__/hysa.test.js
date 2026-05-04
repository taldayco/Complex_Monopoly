import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng } from './helpers.js';
import { applyHysaInterestAtTurnStart } from '../reserve/hysa.js';
import { getHysaRateFor } from '../../shared/reserve/cardCatalog.js';
import { HYSA_BASE_RATE } from '../../shared/constants.js';

function step(state, action, ctx = { rng: makeRng() }) {
  const r = reducer(state, action, ctx);
  if (!r.ok) throw new Error('reducer error: ' + r.error);
  return r.state;
}

test('getHysaRateFor: defaults to seat.hysaRate when no cards', () => {
  const seat = { hysaRate: HYSA_BASE_RATE, creditCards: [] };
  assert.equal(getHysaRateFor(seat, HYSA_BASE_RATE), HYSA_BASE_RATE);
});

test('getHysaRateFor: stacks card bonuses additively', () => {
  const seat = {
    hysaRate: HYSA_BASE_RATE,
    creditCards: [
      { id: 'a', cardId: 'readingRail', status: 'active' },        // +0.01
      { id: 'b', cardId: 'boardwalkPreferred', status: 'active' }  // +0.02
    ]
  };
  // 0.05 + 0.01 + 0.02 = 0.08
  assert.equal(getHysaRateFor(seat, HYSA_BASE_RATE), 0.08);
});

test('applyHysaInterestAtTurnStart: pays seat.cash * rate, mutates cash', () => {
  const seat = { cash: 1000, hysaRate: 0.05, creditCards: [] };
  const r = applyHysaInterestAtTurnStart(seat);
  assert.equal(r.paid, 50);
  assert.equal(seat.cash, 1050);
});

test('applyHysaInterestAtTurnStart: pays nothing on zero or negative cash', () => {
  const seat = { cash: 0, hysaRate: 0.05, creditCards: [] };
  const r = applyHysaInterestAtTurnStart(seat);
  assert.equal(r.paid, 0);
  assert.equal(seat.cash, 0);
});

test('applyHysaInterestAtTurnStart: factors in card bonuses', () => {
  const seat = {
    cash: 1000,
    hysaRate: HYSA_BASE_RATE,
    creditCards: [{ id: 'a', cardId: 'boardwalkPreferred', status: 'active' }]
  };
  const r = applyHysaInterestAtTurnStart(seat);
  // (0.05 + 0.02) * 1000 = 70
  assert.equal(r.paid, 70);
  assert.equal(seat.cash, 1070);
});

test('endTurn: HYSA interest applied to the new active seat', () => {
  let s = makeRoom(2);
  // Seat 1 will receive interest when their turn starts.
  s.seats[1].cash = 1000;
  s.seats[1].hysaRate = HYSA_BASE_RATE; // 0.05
  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s = step(s, { type: 'endTurn', seat: 0 });
  assert.equal(s.turn.seat, 1);
  assert.equal(s.seats[1].cash, 1050);
});

test('endTurn: HYSA interest paid before card rotating fee', () => {
  let s = makeRoom(2);
  s.seats[1].cash = 100;
  s.seats[1].hysaRate = HYSA_BASE_RATE;
  // Add readingRail (rotatingFee 5, hysaBonus 0.01).
  s.seats[1].creditCards.push({
    id: 'CC-rr', cardId: 'readingRail', status: 'active', acquiredAt: 0
  });
  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s = step(s, { type: 'endTurn', seat: 0 });
  // Interest: 100 * (0.05 + 0.01) = 6 → cash 106
  // Then rotating fee: 106 - 5 = 101
  assert.equal(s.seats[1].cash, 101);
});
