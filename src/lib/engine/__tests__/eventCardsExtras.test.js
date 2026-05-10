import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, makeRng, giveProperty } from './helpers.js';
import { applyEventCard } from '../reserve/eventCards.js';

const noop = () => {};

test('cmty.lifeInsurance: +$200', () => {
  const s = makeRoom(2);
  const before = s.seats[0].cash;
  applyEventCard(s, 0, 'community', 'cmty.lifeInsurance', { rng: makeRng() }, noop);
  assert.equal(s.seats[0].cash, before + 200);
});

test('cmty.maintenanceBill: pays $25/house and $75/hotel', () => {
  const s = makeRoom(2);
  giveProperty(s, 0, 1, { houses: 3 });
  giveProperty(s, 0, 3, { houses: 5 });
  const before = s.seats[0].cash;
  applyEventCard(s, 0, 'community', 'cmty.maintenanceBill', { rng: makeRng() }, noop);
  assert.equal(s.seats[0].cash, before - (3 * 25 + 75));
});

test('cmty.taxAppealApproved: +$25 per developed property', () => {
  const s = makeRoom(2);
  giveProperty(s, 0, 1, { houses: 1 });
  giveProperty(s, 0, 3, { houses: 0 });
  giveProperty(s, 0, 6, { houses: 5 });
  const before = s.seats[0].cash;
  applyEventCard(s, 0, 'community', 'cmty.taxAppealApproved', { rng: makeRng() }, noop);
  assert.equal(s.seats[0].cash, before + 50);
});

test('cmty.contractorDiscount: stamps nextDevModifier', () => {
  const s = makeRoom(2);
  applyEventCard(s, 0, 'community', 'cmty.contractorDiscount', { rng: makeRng() }, noop);
  assert.deepEqual(s.seats[0].nextDevModifier, { amount: -0.25, oneHouseOnly: false, consumed: false });
});

test('cmty.permitClerkLikesYou: stamps nextPermitFeeModifier', () => {
  const s = makeRoom(2);
  applyEventCard(s, 0, 'community', 'cmty.permitClerkLikesYou', { rng: makeRng() }, noop);
  assert.deepEqual(s.seats[0].nextPermitFeeModifier, { amount: -0.5, consumed: false });
});

test('cmty.avoidJail: grants 1 avoidJail inventory item', () => {
  const s = makeRoom(2);
  applyEventCard(s, 0, 'community', 'cmty.avoidJail', { rng: makeRng() }, noop);
  assert.equal(s.seats[0].eventInventory.avoidJail, 1);
});

test('cmty.wrongfullyAccused while jailed: leaves jail and pays $200', () => {
  const s = makeRoom(2);
  s.seats[0].inJail = true;
  s.seats[0].jailTurns = 1;
  const before = s.seats[0].cash;
  applyEventCard(s, 0, 'community', 'cmty.wrongfullyAccused', { rng: makeRng() }, noop);
  assert.equal(s.seats[0].inJail, false);
  assert.equal(s.seats[0].cash, before + 200);
});

test('chance.stimulus: $300 to all + 0.5% inflation', () => {
  const s = makeRoom(3);
  const before = s.seats.map((seat) => seat.cash);
  const inflBefore = s.economy.inflationFactor;
  applyEventCard(s, 0, 'chance', 'chance.stimulus', { rng: makeRng() }, noop);
  for (let i = 0; i < s.seats.length; i++) {
    assert.equal(s.seats[i].cash, before[i] + 300);
  }
  assert.equal(s.economy.inflationFactor, Math.round((inflBefore + 0.005) * 1000) / 1000);
});

test('chance.classEnvy: richest pays poorest $100', () => {
  const s = makeRoom(3);
  s.seats[0].cash = 5000;
  s.seats[1].cash = 1500;
  s.seats[2].cash = 100;
  applyEventCard(s, 0, 'chance', 'chance.classEnvy', { rng: makeRng() }, noop);
  assert.equal(s.seats[0].cash, 4900);
  assert.equal(s.seats[2].cash, 200);
});

test('chance.antitrust: full color group owner pays $200', () => {
  const s = makeRoom(2);
  giveProperty(s, 0, 1);
  giveProperty(s, 0, 3);
  const before = s.seats[0].cash;
  applyEventCard(s, 0, 'chance', 'chance.antitrust', { rng: makeRng() }, noop);
  assert.equal(s.seats[0].cash, before - 200);
});

test('chance.boardwalkScandal: -$100 unless Excellent', () => {
  const s = makeRoom(2);
  s.seats[0].bankAccounts.boardwalk.open = true;
  s.seats[0].creditScore = 720;
  s.seats[1].bankAccounts.boardwalk.open = true;
  s.seats[1].creditScore = 820;
  const a = s.seats[0].cash;
  const b = s.seats[1].cash;
  applyEventCard(s, 0, 'chance', 'chance.boardwalkScandal', { rng: makeRng() }, noop);
  assert.equal(s.seats[0].cash, a - 100);
  assert.equal(s.seats[1].cash, b);
});

test('chance.predatoryLawsuit: most-active-loans seat gets +20 credit + $200', () => {
  const s = makeRoom(3);
  s.seats[0].loans = [{ status: 'active', balance: 100 }];
  s.seats[1].loans = [
    { status: 'active', balance: 100 },
    { status: 'active', balance: 200 }
  ];
  s.seats[1].creditScore = 700;
  const cashBefore = s.seats[1].cash;
  applyEventCard(s, 0, 'chance', 'chance.predatoryLawsuit', { rng: makeRng() }, noop);
  assert.equal(s.seats[1].creditScore, 720);
  assert.equal(s.seats[1].cash, cashBefore + 200);
});

test('chance.regionalBankFailure: clamps balances above FDIC on chosen bank', () => {
  const s = makeRoom(2);
  s.seats[0].bankAccounts.mmcu = { open: true, balance: 7000, openedAt: 0 };
  s.seats[0].bankAccounts.boardwalk = { open: true, balance: 7000, openedAt: 0 };
  const r = applyEventCard(s, 0, 'chance', 'chance.regionalBankFailure', { rng: () => 0 }, noop);
  const eff = r.results.effects[0];
  if (eff.bank === 'mmcu') {
    assert.equal(s.seats[0].bankAccounts.mmcu.balance, 5000);
    assert.equal(s.seats[0].bankAccounts.boardwalk.balance, 7000);
  } else {
    assert.equal(s.seats[0].bankAccounts.mmcu.balance, 7000);
    assert.equal(s.seats[0].bankAccounts.boardwalk.balance, 5000);
  }
});

test('chance.recoveryRally20: +20% all stocks', () => {
  const s = makeRoom(2);
  const before = s.stocks.market.TPHT.price;
  applyEventCard(s, 0, 'chance', 'chance.recoveryRally20', { rng: makeRng() }, noop);
  assert.equal(s.stocks.market.TPHT.price, Math.round(before * 1.2 * 100) / 100);
});

test('chance.dividendSeason: 5% dividend across owned stocks', () => {
  const s = makeRoom(2);
  s.seats[0].stockLots = { TPHT: 10 };
  const price = s.stocks.market.TPHT.price;
  const cashBefore = s.seats[0].cash;
  applyEventCard(s, 0, 'chance', 'chance.dividendSeason', { rng: makeRng() }, noop);
  const expected = Math.round(10 * price * 0.05 * 100) / 100;
  assert.equal(s.seats[0].cash, Math.round((cashBefore + expected) * 100) / 100);
});
