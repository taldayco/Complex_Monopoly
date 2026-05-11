import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng, step, stepWithEvents } from './helpers.js';

function makeRollOffRoom(playerCount = 4) {
  const room = makeRoom(playerCount);
  room.phase = 'rollOff';
  room.rollOff = {
    contenders: room.seats.map((s) => s.seat),
    rolls: {},
    settledOrder: [],
    round: 1
  };
  return room;
}

function fakeDiceRng(values) {
  const queue = values.map((v) => (v - 1) / 6 + 0.0001);
  let i = 0;
  return () => {
    if (i >= queue.length) throw new Error('fakeDiceRng exhausted at index ' + i);
    return queue[i++];
  };
}

test('rollForOrder is the only action accepted in the rollOff phase', () => {
  const s = makeRollOffRoom(2);
  const r = reducer(s, { type: 'rollDice', seat: 0 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NOT_PLAYING');
});

test('happy path: highest goes first, others rotate from their lobby order', () => {
  let s = makeRollOffRoom(3);
  const ctx = { rng: fakeDiceRng([3, 4, /*seat0=7*/ 5, 6, /*seat1=11*/ 1, 3 /*seat2=4*/]) };

  s = step(s, { type: 'rollForOrder', seat: 0 }, ctx);
  assert.equal(s.phase, 'rollOff', 'still rolling after seat 0');
  s = step(s, { type: 'rollForOrder', seat: 1 }, ctx);
  assert.equal(s.phase, 'rollOff', 'still rolling after seat 1');
  let last;
  ({ state: s, events: last } = stepWithEvents(s, { type: 'rollForOrder', seat: 2 }, ctx));

  assert.equal(s.phase, 'playing');
  assert.equal(s.rollOff, null);
  assert.equal(s.seats[0].name, 'P1');
  assert.equal(s.seats[1].name, 'P2');
  assert.equal(s.seats[2].name, 'P0');
  assert.equal(s.seats[0].seat, 0);
  assert.equal(s.seats[1].seat, 1);
  assert.equal(s.seats[2].seat, 2);
  assert.equal(s.turn.seat, 0);
  assert.equal(s.turn.phase, 'preRoll');
  const done = last.find((e) => e.type === 'rollOffComplete');
  assert.ok(done, 'rollOffComplete logged');
  assert.equal(done.payload.winnerOriginalSeat, 1);
  assert.equal(done.payload.winnerTotal, 11);
});

test('rejects double-roll within the same round', () => {
  let s = makeRollOffRoom(2);
  const ctx = { rng: fakeDiceRng([3, 4, 5, 6]) };
  s = step(s, { type: 'rollForOrder', seat: 0 }, ctx);
  const r = reducer(s, { type: 'rollForOrder', seat: 0 }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'ALREADY_ROLLED');
});

test('rejects a non-contender seat from rolling during a tie re-roll', () => {
  let s = makeRollOffRoom(3);
  s.rollOff.contenders = [0, 2];
  s.rollOff.round = 2;
  const ctx = { rng: fakeDiceRng([3, 4]) };
  const r = reducer(s, { type: 'rollForOrder', seat: 1 }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NOT_CONTENDER');
});

test('tie among top scorers re-rolls only the tied seats', () => {
  let s = makeRollOffRoom(3);
  const ctx = {
    rng: fakeDiceRng([
      3, 4,
      4, 3,
      1, 3,
      4, 5,
      2, 3
    ])
  };

  s = step(s, { type: 'rollForOrder', seat: 0 }, ctx);
  s = step(s, { type: 'rollForOrder', seat: 1 }, ctx);
  let r1;
  ({ state: s, events: r1 } = stepWithEvents(s, { type: 'rollForOrder', seat: 2 }, ctx));

  assert.equal(s.phase, 'rollOff');
  assert.deepEqual(s.rollOff.contenders.sort(), [0, 1]);
  assert.equal(s.rollOff.round, 2);
  assert.ok(r1.find((e) => e.type === 'rollOffTieReroll'), 'rollOffTieReroll logged on tie');

  const blocked = reducer(s, { type: 'rollForOrder', seat: 2 }, ctx);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'NOT_CONTENDER');

  s = step(s, { type: 'rollForOrder', seat: 0 }, ctx);
  s = step(s, { type: 'rollForOrder', seat: 1 }, ctx);

  assert.equal(s.phase, 'playing');
  assert.equal(s.seats[0].name, 'P0');
  assert.equal(s.seats[1].name, 'P1');
  assert.equal(s.seats[2].name, 'P2');
});

test('two-player tie re-rolls until a unique winner emerges', () => {
  let s = makeRollOffRoom(2);
  const ctx = {
    rng: fakeDiceRng([
      3, 4,
      4, 3,
      2, 3,
      3, 2,
      4, 4,
      2, 4
    ])
  };

  s = step(s, { type: 'rollForOrder', seat: 0 }, ctx);
  s = step(s, { type: 'rollForOrder', seat: 1 }, ctx);
  assert.equal(s.phase, 'rollOff');
  assert.equal(s.rollOff.round, 2);

  s = step(s, { type: 'rollForOrder', seat: 0 }, ctx);
  s = step(s, { type: 'rollForOrder', seat: 1 }, ctx);
  assert.equal(s.phase, 'rollOff');
  assert.equal(s.rollOff.round, 3);

  s = step(s, { type: 'rollForOrder', seat: 0 }, ctx);
  s = step(s, { type: 'rollForOrder', seat: 1 }, ctx);
  assert.equal(s.phase, 'playing');
  assert.equal(s.seats[0].name, 'P0');
  assert.equal(s.seats[1].name, 'P1');
});
