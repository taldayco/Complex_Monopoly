import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRent } from '../rent.js';
import { makeRoom, giveProperty } from './helpers.js';

test('rent: unowned property returns 0', () => {
  const room = makeRoom(2);
  assert.equal(computeRent(room, 1, 0), 0);
});

test('rent: base rent on a single property without monopoly', () => {
  const room = makeRoom(2);
  giveProperty(room, 1, 1); // Mediterranean: base rent 2
  assert.equal(computeRent(room, 1, 0), 2);
});

test('rent: monopoly with 0 houses doubles base rent', () => {
  const room = makeRoom(2);
  giveProperty(room, 1, 1); // Mediterranean
  giveProperty(room, 1, 3); // Baltic — full brown set
  assert.equal(computeRent(room, 1, 0), 2 * 2);
  assert.equal(computeRent(room, 3, 0), 4 * 2);
});

test('rent: house ladder', () => {
  const room = makeRoom(2);
  giveProperty(room, 1, 1, { houses: 1 });
  assert.equal(computeRent(room, 1, 0), 10);
  giveProperty(room, 1, 1, { houses: 2 });
  assert.equal(computeRent(room, 1, 0), 30);
  giveProperty(room, 1, 1, { houses: 5 }); // hotel
  assert.equal(computeRent(room, 1, 0), 250);
});

test('rent: mortgaged property pays no rent', () => {
  const room = makeRoom(2);
  giveProperty(room, 1, 1, { mortgaged: true });
  assert.equal(computeRent(room, 1, 0), 0);
});

test('rent: railroads scale with count owned', () => {
  const room = makeRoom(2);
  giveProperty(room, 1, 5);
  assert.equal(computeRent(room, 5, 0), 25);
  giveProperty(room, 1, 15);
  assert.equal(computeRent(room, 5, 0), 50);
  giveProperty(room, 1, 25);
  assert.equal(computeRent(room, 5, 0), 100);
  giveProperty(room, 1, 35);
  assert.equal(computeRent(room, 5, 0), 200);
});

test('rent: utility 1 owned = (props + devs) × 10', () => {
  const room = makeRoom(2);
  giveProperty(room, 1, 12);
  assert.equal(computeRent(room, 12, 7), 10);
});

test('rent: utility 2 owned = (props + devs) × 15', () => {
  const room = makeRoom(2);
  giveProperty(room, 1, 12);
  giveProperty(room, 1, 28);
  assert.equal(computeRent(room, 12, 7), 30);
});

test('rent: chance card railroad multiplier overrides count', () => {
  const room = makeRoom(2);
  giveProperty(room, 1, 5); // 1 RR
  // Normally 25, but with 2x = 50
  assert.equal(computeRent(room, 5, 0, { railroadMultiplier: 2 }), 50);
});

test('rent: chance card utility 10x dice override', () => {
  const room = makeRoom(2);
  giveProperty(room, 1, 12); // 1 utility, normally 4x dice
  assert.equal(computeRent(room, 12, 7, { utilityMultiplier: 10 }), 70);
});
