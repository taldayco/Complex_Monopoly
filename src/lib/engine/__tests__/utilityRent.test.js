import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRent } from '../rent.js';
import { makeRoom, giveProperty } from './helpers.js';

test('utility rent: lander has 1 property → (1+0) × 10 = 10', () => {
  const room = makeRoom(2);
  giveProperty(room, 1, 12);
  giveProperty(room, 0, 1);
  assert.equal(computeRent(room, 12, 7, { landerSeat: 0 }), 10);
});

test('utility rent: spec example — lander 6 props + 2 hotels + 4 houses, owner owns both utilities → 240', () => {
  const room = makeRoom(2);
  giveProperty(room, 1, 12);
  giveProperty(room, 1, 28);
  giveProperty(room, 0, 1);
  giveProperty(room, 0, 3);
  giveProperty(room, 0, 5);
  giveProperty(room, 0, 8, { houses: 4 });
  giveProperty(room, 0, 11, { houses: 5 });
  giveProperty(room, 0, 13, { houses: 5 });
  assert.equal(computeRent(room, 12, 7, { landerSeat: 0 }), 240);
});

test('utility rent: hotels count as 3 developments on the lander', () => {
  const room = makeRoom(2);
  giveProperty(room, 1, 12);
  giveProperty(room, 0, 1, { houses: 5 });
  assert.equal(computeRent(room, 12, 7, { landerSeat: 0 }), (1 + 3) * 10);
});

test('utility rent: chance card multiplier override still uses dice', () => {
  const room = makeRoom(2);
  giveProperty(room, 1, 12);
  assert.equal(computeRent(room, 12, 7, { utilityMultiplier: 10 }), 70);
});

test('utility rent: ignores dice total entirely under spec formula', () => {
  const room = makeRoom(2);
  giveProperty(room, 1, 12);
  giveProperty(room, 0, 1);
  assert.equal(computeRent(room, 12, 2, { landerSeat: 0 }), 10);
  assert.equal(computeRent(room, 12, 12, { landerSeat: 0 }), 10);
});

test('utility rent: when owner has 2 utilities, multiplier is 15', () => {
  const room = makeRoom(2);
  giveProperty(room, 1, 12);
  giveProperty(room, 1, 28);
  giveProperty(room, 0, 1);
  giveProperty(room, 0, 3);
  assert.equal(computeRent(room, 12, 7, { landerSeat: 0 }), (2) * 15);
});
