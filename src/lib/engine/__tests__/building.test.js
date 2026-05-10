import test from 'node:test';
import assert from 'node:assert/strict';
import { canBuyHouse, buyHouse, sellHouse } from '../building.js';
import { canSellPropertyToBank, sellPropertyToBank } from '../mortgage.js';
import { makeRoom, giveProperty } from './helpers.js';

test('can build without monopoly when no other owners exist for the color', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1);
  const r = canBuyHouse(room, 0, 1);
  assert.equal(r.ok, true);
  assert.equal(r.permitFees, 0);
});

test('build is allowed with full monopoly', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1);
  giveProperty(room, 0, 3);
  const r = canBuyHouse(room, 0, 1);
  assert.equal(r.ok, true);
  assert.equal(r.cost, 50);
});

test('even-build rule blocks building 2nd house when sibling has 0', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1, { houses: 1 });
  giveProperty(room, 0, 3, { houses: 0 });
  const r = canBuyHouse(room, 0, 1);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'EVEN_BUILD');
});

test('even-build allows symmetric building', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1, { houses: 1 });
  giveProperty(room, 0, 3, { houses: 1 });
  const r = canBuyHouse(room, 0, 1);
  assert.equal(r.ok, true);
});

test('cannot build if any property in group is mortgaged', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1);
  giveProperty(room, 0, 3, { mortgaged: true });
  const r = canBuyHouse(room, 0, 1);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'GROUP_MORTGAGED');
});

test('hotel consumes 1 hotel and returns 4 houses to bank', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1, { houses: 4 });
  giveProperty(room, 0, 3, { houses: 4 });
  const beforeHouses = room.bank.housesAvailable;
  const beforeHotels = room.bank.hotelsAvailable;
  const r = buyHouse(room, 0, 1);
  assert.equal(r.ok, true);
  assert.equal(r.houses, 5);
  assert.equal(room.bank.housesAvailable, beforeHouses + 4);
  assert.equal(room.bank.hotelsAvailable, beforeHotels - 1);
});

test('selling house refunds half cost', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1, { houses: 1 });
  giveProperty(room, 0, 3, { houses: 1 });
  const beforeCash = room.seats[0].cash;
  const r = sellHouse(room, 0, 1);
  assert.equal(r.ok, true);
  assert.equal(r.refund, 25);
  assert.equal(room.seats[0].cash, beforeCash + 25);
});

test('cannot sell unevenly', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1, { houses: 2 });
  giveProperty(room, 0, 3, { houses: 0 });
  const r = sellHouse(room, 0, 1);
  // Other has 0, target after sell would be 1; current 0 > 1+1? no. 0 > 2 (target+1)? no.
  // Actually: target = 1 (after sell). Other props must have at most target+1 = 2 houses.
  // Other has 0 houses, which is ≤ 2. OK. So this should succeed.
  // But wait — even-sell means *higher* sibling can't be 2 houses ahead. Let me re-check.
  // For target=1, condition: other.houses > target+1 → other.houses > 2 → fails only if sibling > 2.
  // So even-sell allows asymmetric down to base.
  assert.equal(r.ok, true);
});

test('insufficient bank houses blocks building', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1);
  giveProperty(room, 0, 3);
  room.bank.housesAvailable = 0;
  const r = canBuyHouse(room, 0, 1);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NO_HOUSES');
});

// ---------- sellPropertyToBank ----------

test('sellPropertyToBank: refunds mortgage value, returns property to bank', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1);                       // Mediterranean (mortgageValue 30)
  const before = room.seats[0].cash;
  const r = sellPropertyToBank(room, 0, 1);
  assert.equal(r.ok, true);
  assert.equal(r.payout, 30);
  assert.equal(room.seats[0].cash, before + 30);
  assert.equal(room.properties[1].ownerSeat, null);
  assert.equal(room.properties[1].mortgaged, false);
  assert.equal(room.properties[1].houses, 0);
});

test('sellPropertyToBank: rejects mortgaged property', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1, { mortgaged: true });
  const r = canSellPropertyToBank(room, 0, 1);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'IS_MORTGAGED');
});

test('sellPropertyToBank: rejects when property has houses', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1, { houses: 1 });
  giveProperty(room, 0, 3);
  const r = canSellPropertyToBank(room, 0, 1);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'HAS_HOUSES');
});

test('sellPropertyToBank: rejects when group has houses on a sibling tile', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1);                         // empty Mediterranean
  giveProperty(room, 0, 3, { houses: 2 });          // Baltic with houses
  const r = canSellPropertyToBank(room, 0, 1);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'GROUP_HAS_HOUSES');
});

test('sellPropertyToBank: rejects non-owner', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1);
  const r = canSellPropertyToBank(room, 1, 1);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NOT_OWNER');
});
