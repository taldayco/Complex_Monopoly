import test from 'node:test';
import assert from 'node:assert/strict';
import { canBuyHouse, buyHouse, calcPermitFees } from '../building.js';
import { makeRoom, giveProperty } from './helpers.js';
import { BOARD } from '../../shared/board.js';

test('calcPermitFees: no other owners → 0 fees', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1);
  const r = calcPermitFees(room, 0, 1, 50);
  assert.equal(r.totalFees, 0);
  assert.equal(r.feesByRecipient.size, 0);
});

test('calcPermitFees: 1 sibling owned by other player → 25% of subtotal to that player', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1);
  giveProperty(room, 1, 3);
  const r = calcPermitFees(room, 0, 1, 200);
  assert.equal(r.totalFees, 50);
  assert.equal(r.feesByRecipient.get(1), 50);
});

test('calcPermitFees: 2 siblings both owned by same other player → fees stack', () => {
  const room = makeRoom(3);
  giveProperty(room, 0, 16);
  giveProperty(room, 1, 18);
  giveProperty(room, 1, 19);
  const r = calcPermitFees(room, 0, 16, 200);
  assert.equal(r.totalFees, 100);
  assert.equal(r.feesByRecipient.get(1), 100);
});

test('calcPermitFees: 2 siblings owned by different other players → fees split', () => {
  const room = makeRoom(3);
  giveProperty(room, 0, 16);
  giveProperty(room, 1, 18);
  giveProperty(room, 2, 19);
  const r = calcPermitFees(room, 0, 16, 200);
  assert.equal(r.totalFees, 100);
  assert.equal(r.feesByRecipient.get(1), 50);
  assert.equal(r.feesByRecipient.get(2), 50);
});

test('calcPermitFees: self-owned siblings excluded', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 16);
  giveProperty(room, 0, 18);
  giveProperty(room, 1, 19);
  const r = calcPermitFees(room, 0, 16, 200);
  assert.equal(r.totalFees, 50);
  assert.equal(r.feesByRecipient.get(1), 50);
});

test('canBuyHouse: rejects when seat cant cover devCost + permit fees', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 16);
  giveProperty(room, 1, 18);
  const space = BOARD[16];
  room.seats[0].cash = space.houseCost + 1;
  const r = canBuyHouse(room, 0, 16);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS');
});

test('buyHouse: pays permit fees to other-color owners and devCost to bank', () => {
  const room = makeRoom(3);
  giveProperty(room, 0, 16);
  giveProperty(room, 1, 18);
  giveProperty(room, 2, 19);
  const space = BOARD[16];
  const ownerCashBefore = room.seats[0].cash;
  const a = room.seats[1].cash;
  const b = room.seats[2].cash;
  const r = buyHouse(room, 0, 16);
  assert.equal(r.ok, true);
  const fee = Math.round(space.houseCost * 0.25 * 100) / 100;
  assert.equal(room.seats[1].cash, a + fee);
  assert.equal(room.seats[2].cash, b + fee);
  assert.equal(room.seats[0].cash, Math.round((ownerCashBefore - space.houseCost - fee * 2) * 100) / 100);
  assert.equal(room.properties[16].houses, 1);
});

test('buyHouse: no fees when player owns all in color group', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 16);
  giveProperty(room, 0, 18);
  giveProperty(room, 0, 19);
  const space = BOARD[16];
  const before = room.seats[0].cash;
  const r = buyHouse(room, 0, 16);
  assert.equal(r.ok, true);
  assert.equal(r.permitFees, 0);
  assert.equal(room.seats[0].cash, before - space.houseCost);
});

test('inflation factor inflates both devCost and permit fees', () => {
  const room = makeRoom(2);
  room.economy.inflationFactor = 2;
  giveProperty(room, 0, 16);
  giveProperty(room, 1, 18);
  const space = BOARD[16];
  const r = canBuyHouse(room, 0, 16);
  assert.equal(r.ok, true);
  assert.equal(r.cost, space.houseCost * 2);
  const expectedFee = Math.round((space.houseCost * 2 * 0.25) * 100) / 100;
  assert.equal(r.permitFees, expectedFee);
});

test('build with single property in color, no others owned: works without monopoly', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1);
  const r = buyHouse(room, 0, 1);
  assert.equal(r.ok, true);
  assert.equal(r.houses, 1);
});
