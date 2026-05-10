import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, giveProperty } from './helpers.js';
import { validateTrade, executeTrade } from '../trade.js';

function basicTrade(fromSeat, toSeat, offer = {}, request = {}) {
  return {
    fromSeat,
    toSeat,
    offer: { cash: 0, properties: [], ...offer },
    request: { cash: 0, properties: [], ...request }
  };
}

test('trade: clean property swap with cash transfers ownership and rounds cash', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1);
  giveProperty(room, 1, 3);
  room.seats[0].cash = 1500;
  room.seats[1].cash = 1500;
  const r = executeTrade(room, basicTrade(0, 1,
    { cash: 100, properties: [1] },
    { cash: 200, properties: [3] }
  ));
  assert.equal(r.ok, true);
  assert.equal(room.properties[1].ownerSeat, 1);
  assert.equal(room.properties[3].ownerSeat, 0);
  assert.equal(room.seats[0].cash, 1500 - 100 + 200);
  assert.equal(room.seats[1].cash, 1500 + 100 - 200);
});

test('trade: blocks mortgaged property on offer side', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1, { mortgaged: true });
  const r = validateTrade(room, basicTrade(0, 1, { properties: [1] }));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'MORTGAGED');
});

test('trade: blocks mortgaged property on request side', () => {
  const room = makeRoom(2);
  giveProperty(room, 1, 3, { mortgaged: true });
  const r = validateTrade(room, basicTrade(0, 1, {}, { properties: [3] }));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'MORTGAGED');
  assert.equal(r.side, 'request');
});

test('trade: still blocks property with houses (regression)', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1, { houses: 1 });
  const r = validateTrade(room, basicTrade(0, 1, { properties: [1] }));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'HAS_HOUSES');
});

test('trade: rejects when offer side cash exceeds seat cash', () => {
  const room = makeRoom(2);
  room.seats[0].cash = 50;
  const r = validateTrade(room, basicTrade(0, 1, { cash: 100 }));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS');
});

test('trade: rejects negative cash', () => {
  const room = makeRoom(2);
  const r = validateTrade(room, basicTrade(0, 1, { cash: -50 }));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NEGATIVE_CASH');
});

test('trade: bankrupt seat cannot trade', () => {
  const room = makeRoom(2);
  room.seats[0].bankrupt = true;
  const r = validateTrade(room, basicTrade(0, 1));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'BANKRUPT');
});

test('trade: jail-free card transfers and clears on giver', () => {
  const room = makeRoom(2);
  room.seats[0].getOutOfJailFreeChance = true;
  const r = executeTrade(room, basicTrade(0, 1, { jailFreeChance: true }));
  assert.equal(r.ok, true);
  assert.equal(room.seats[0].getOutOfJailFreeChance, false);
  assert.equal(room.seats[1].getOutOfJailFreeChance, true);
});
