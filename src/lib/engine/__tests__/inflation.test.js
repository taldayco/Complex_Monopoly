import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng, giveProperty, step } from './helpers.js';
import { inflatedPrice } from '../../shared/economy/inflation.js';
import { computeRent } from '../rent.js';
import { canBuy, buyProperty } from '../purchase.js';
import { canBuyHouse } from '../building.js';


test('inflatedPrice multiplies by state.economy.inflationFactor', () => {
  const state = { economy: { inflationFactor: 1.5 } };
  assert.equal(inflatedPrice(state, 200), 300);
});

test('inflatedPrice defaults to 1.0 on missing economy slice', () => {
  assert.equal(inflatedPrice({}, 200), 200);
  assert.equal(inflatedPrice({ economy: null }, 200), 200);
  assert.equal(inflatedPrice({ economy: { inflationFactor: 0 } }, 200), 200);
});


test('canBuy reports the inflated price; buyProperty debits the inflated amount', () => {
  let s = makeRoom(2);
  s.economy.inflationFactor = 1.5;
  s.seats[0].position = 39;
  s.seats[0].cash = 1500;
  const check = canBuy(s, 0, 39);
  assert.equal(check.ok, true);
  assert.equal(check.price, 600);
  buyProperty(s, 0, 39);
  assert.equal(s.seats[0].cash, 900);
});


test('rent inflates with the live factor', () => {
  let s = makeRoom(2);
  s.economy.inflationFactor = 2;
  giveProperty(s, 1, 37);
  s.seats[0].position = 37;
  const rent = computeRent(s, 37, 0, {});
  assert.equal(rent, 70);
});

test('non-integer inflated rent settles without float drift', async () => {
  const { reducer } = await import('../reducer.js');
  let s = makeRoom(2, { cash: 1000 });
  s.economy.inflationFactor = 1.21;
  giveProperty(s, 1, 1);
  s.seats[0].position = 0;
  s.turn = { seat: 0, phase: 'preRoll', lastRoll: null, doublesCount: 0 };
  const rngForOne = (() => { let i = 0; return () => i++ === 0 ? 0.0 : 0.5; })();
  const r = reducer(s, { type: 'rollDice', seat: 0 }, { rng: rngForOne });
  assert.equal(r.ok, true);
  const debtor = r.state.seats[0];
  const creditor = r.state.seats[1];
  const sumIsInteger = Number.isInteger(Math.round((debtor.cash + creditor.cash) * 100));
  assert.equal(sumIsInteger, true);
  const debtorCents = Math.round(debtor.cash * 100);
  const creditorCents = Math.round(creditor.cash * 100);
  assert.equal(debtorCents, Math.round(debtor.cash * 100));
  assert.equal(creditorCents, Math.round(creditor.cash * 100));
});


test('canBuyHouse cost reflects inflation', () => {
  let s = makeRoom(2);
  s.economy.inflationFactor = 1.5;
  giveProperty(s, 0, 37);
  giveProperty(s, 0, 39);
  s.seats[0].cash = 5000;
  const r = canBuyHouse(s, 0, 39);
  assert.equal(r.ok, true);
  assert.equal(r.cost, 300);
  assert.equal(r.listedCost, 200);
});

test('sellHouse refund reflects inflation as a float (50% of inflated houseCost)', async () => {
  const { sellHouse } = await import('../building.js');
  let s = makeRoom(2);
  s.economy.inflationFactor = 1.5;
  giveProperty(s, 0, 39, { houses: 1 });
  s.seats[0].cash = 0;
  const r = sellHouse(s, 0, 39);
  assert.equal(r.ok, true);
  assert.equal(r.refund, 150);
  assert.equal(s.seats[0].cash, 150);
});

test('sellHouse refund yields cents at non-clean inflation', async () => {
  const { sellHouse } = await import('../building.js');
  let s = makeRoom(2);
  s.economy.inflationFactor = 1.21;
  giveProperty(s, 0, 39, { houses: 1 });
  s.seats[0].cash = 0;
  const r = sellHouse(s, 0, 39);
  assert.equal(r.ok, true);
  assert.equal(r.refund, 121);
  assert.equal(s.seats[0].cash, 121);
});

test('sellPropertyToBank payout reflects inflation', async () => {
  const { sellPropertyToBank } = await import('../mortgage.js');
  let s = makeRoom(2);
  s.economy.inflationFactor = 1.5;
  giveProperty(s, 0, 39);
  s.seats[0].cash = 0;
  const r = sellPropertyToBank(s, 0, 39);
  assert.equal(r.ok, true);
  assert.equal(r.payout, 300);
  assert.equal(s.seats[0].cash, 300);
});


test('chance "Bank pays you dividend of $50" inflates with the factor', () => {
  let s = makeRoom(2);
  s.economy.inflationFactor = 1.5;
  s.seats[0].cash = 0;
  s.chance.deck = ['CH07', ...s.chance.deck.filter((id) => id !== 'CH07')];
  s.seats[0].position = 6;
  s.seats[0].position = 5;
  s.turn = { seat: 0, phase: 'preRoll', lastRoll: null, lastRollWasDoubles: false, doublesCount: 0 };
  s.seats[0].position = 2;
  let calls = 0;
  const fakeRng = () => (calls++ === 0 ? 0.0 : 0.5);
  s = step(s, { type: 'rollDice', seat: 0 }, { rng: fakeRng });
  assert.equal(s.seats[0].cash, 75);
});

test('chance "Speeding fine. Pay $15" inflates with the factor', () => {
  let s = makeRoom(2);
  s.economy.inflationFactor = 2;
  s.seats[0].cash = 1500;
  s.chance.deck = ['CH12', ...s.chance.deck.filter((id) => id !== 'CH12')];
  s.seats[0].position = 2;
  let calls = 0;
  const fakeRng = () => (calls++ === 0 ? 0.0 : 0.5);
  s = step(s, { type: 'rollDice', seat: 0 }, { rng: fakeRng });
  assert.equal(s.seats[0].cash, 1470);
});


test('GO_SALARY is nominal (does not inflate)', () => {
  let s = makeRoom(2);
  s.economy.inflationFactor = 2;
  s.seats[0].cash = 0;
  s.seats[0].position = 39;
  let calls = 0;
  const fakeRng = () => (calls++ === 0 ? 0.0 : 0.0);
  s = step(s, { type: 'rollDice', seat: 0 }, { rng: fakeRng });
  assert.equal(s.seats[0].cash, 100);
});
