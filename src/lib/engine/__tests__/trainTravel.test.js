import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng, giveProperty } from './helpers.js';

function step(state, action, ctx = { rng: makeRng() }) {
  const r = reducer(state, action, ctx);
  if (!r.ok) throw new Error('reducer error: ' + r.error);
  return r.state;
}

function landSeatOnRailroad(s, seatIdx, railIdx) {
  s.seats[seatIdx].position = (railIdx + 40 - 2) % 40;
  const rng = () => 0;
  return step(s, { type: 'rollDice', seat: seatIdx }, { rng });
}

test('single owner of 2+ railroads → travelable = same-owner railroads only', () => {
  let s = makeRoom(2);
  giveProperty(s, 1, 5);
  giveProperty(s, 1, 15);
  giveProperty(s, 1, 25);
  s = landSeatOnRailroad(s, 0, 5);
  assert.ok(s.pendingTrainTravel);
  assert.equal(s.pendingTrainTravel.seat, 0);
  assert.equal(s.pendingTrainTravel.fromIdx, 5);
  assert.deepEqual(s.pendingTrainTravel.choices.sort((a, b) => a - b), [15, 25]);
});

test('all owned railroads owned by different players → travel to any owned', () => {
  let s = makeRoom(4);
  giveProperty(s, 1, 5);
  giveProperty(s, 2, 15);
  giveProperty(s, 3, 25);
  s = landSeatOnRailroad(s, 0, 5);
  assert.ok(s.pendingTrainTravel);
  assert.deepEqual(s.pendingTrainTravel.choices.sort((a, b) => a - b), [15, 25]);
});

test('current owner owns 2+ → travel only to same-owner railroads', () => {
  let s = makeRoom(3);
  giveProperty(s, 1, 5);
  giveProperty(s, 2, 15);
  giveProperty(s, 1, 25);
  s = landSeatOnRailroad(s, 0, 5);
  assert.deepEqual(s.pendingTrainTravel.choices, [25]);
});

test('only one owned railroad in play → no travel offered (only fromIdx exists)', () => {
  let s = makeRoom(2);
  giveProperty(s, 1, 5);
  s = landSeatOnRailroad(s, 0, 5);
  assert.equal(s.pendingTrainTravel, null);
});

test('chooseTrainDestination: moves seat to chosen index, no GO if not crossed', () => {
  let s = makeRoom(2);
  giveProperty(s, 1, 5);
  giveProperty(s, 1, 15);
  s = landSeatOnRailroad(s, 0, 5);
  const beforeCash = s.seats[0].cash;
  s = step(s, { type: 'chooseTrainDestination', seat: 0, spaceIndex: 15 });
  assert.equal(s.seats[0].position, 15);
  assert.equal(s.seats[0].cash, beforeCash);
  assert.equal(s.pendingTrainTravel, null);
});

test('chooseTrainDestination: passes GO when destination index < fromIdx (collects $100)', () => {
  let s = makeRoom(2);
  giveProperty(s, 1, 5);
  giveProperty(s, 1, 35);
  s = landSeatOnRailroad(s, 0, 35);
  assert.equal(s.seats[0].position, 35);
  const beforeCash = s.seats[0].cash;
  s = step(s, { type: 'chooseTrainDestination', seat: 0, spaceIndex: 5 });
  assert.equal(s.seats[0].position, 5);
  assert.equal(s.seats[0].cash, beforeCash + 100);
});

test('skipTrainTravel: clears pending without moving', () => {
  let s = makeRoom(2);
  giveProperty(s, 1, 5);
  giveProperty(s, 1, 15);
  s = landSeatOnRailroad(s, 0, 5);
  s = step(s, { type: 'skipTrainTravel', seat: 0 });
  assert.equal(s.seats[0].position, 5);
  assert.equal(s.pendingTrainTravel, null);
});

test('owner traveling between own railroads pays no rent and gets travel offer', () => {
  let s = makeRoom(2);
  giveProperty(s, 0, 5);
  giveProperty(s, 0, 15);
  const beforeCash = s.seats[0].cash;
  s = landSeatOnRailroad(s, 0, 5);
  assert.equal(s.seats[0].cash, beforeCash);
  assert.ok(s.pendingTrainTravel);
});

test('chooseTrainDestination rejects invalid space', () => {
  let s = makeRoom(2);
  giveProperty(s, 1, 5);
  giveProperty(s, 1, 15);
  s = landSeatOnRailroad(s, 0, 5);
  const r = reducer(s, { type: 'chooseTrainDestination', seat: 0, spaceIndex: 25 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INVALID_CHOICE');
});
