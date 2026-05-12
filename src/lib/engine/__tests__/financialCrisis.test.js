import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, makeRng } from './helpers.js';
import { applyEventCard } from '../reserve/eventCards.js';
import { flipEconomy, expireEconomyTempEffects } from '../reserve/economy.js';

const noop = () => {};

test('chance.financialCrisis resets inflation to 1.0 and pushes both freeze effects', () => {
  const s = makeRoom(2);
  s.economy.inflationFactor = 1.45;
  s.turnCount = 5;
  applyEventCard(s, 0, 'chance', 'chance.financialCrisis', { rng: makeRng() }, noop);
  assert.equal(s.economy.inflationFactor, 1);
  const kinds = s.economy.tempEffects.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ['inflationFreeze', 'interestFreeze']);
  const inf = s.economy.tempEffects.find((e) => e.kind === 'inflationFreeze');
  const intf = s.economy.tempEffects.find((e) => e.kind === 'interestFreeze');
  assert.equal(inf.expiresAtTurn, 15);
  assert.equal(intf.expiresAtTurn, 13);
});

test('chance.financialCrisis clamps both bank balances above $5000 FDIC cap', () => {
  const s = makeRoom(2);
  s.seats[0].bankAccounts = {
    mmcu: { open: true, balance: 8000, openedAt: 0 },
    boardwalk: { open: true, balance: 12000, openedAt: 0 }
  };
  applyEventCard(s, 0, 'chance', 'chance.financialCrisis', { rng: makeRng() }, noop);
  assert.equal(s.seats[0].bankAccounts.mmcu.balance, 5000);
  assert.equal(s.seats[0].bankAccounts.boardwalk.balance, 5000);
});

test('flipEconomy suppresses inflationFactor delta while inflationFreeze is active', () => {
  const s = makeRoom(2);
  s.economy.inflationFactor = 1;
  s.economy.tempEffects = [{ kind: 'inflationFreeze', expiresAtTurn: 100 }];
  s.economy.deck = [{ inf: 0.5, wild: false }];
  flipEconomy(s.economy, makeRng());
  assert.equal(s.economy.inflationFactor, 1);
});

test('flipEconomy suppresses reserveRate delta while interestFreeze is active', () => {
  const s = makeRoom(2);
  s.economy.reserveRate = 0;
  s.economy.tempEffects = [{ kind: 'interestFreeze', expiresAtTurn: 100 }];
  s.economy.deck = [{ inf: 0, wild: false }];
  flipEconomy(s.economy, makeRng());
  assert.equal(s.economy.reserveRate, 0);
});

test('expireEconomyTempEffects removes expired entries and preserves inflationFactor on inflationFreeze expiry', () => {
  const s = makeRoom(2);
  s.economy.inflationFactor = 1.5;
  s.economy.tempEffects = [
    { kind: 'inflationFreeze', expiresAtTurn: 5 },
    { kind: 'interestFreeze', expiresAtTurn: 8 }
  ];
  const expired = expireEconomyTempEffects(s.economy, 5);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].kind, 'inflationFreeze');
  assert.equal(s.economy.tempEffects.length, 1);
  assert.equal(s.economy.tempEffects[0].kind, 'interestFreeze');
  assert.equal(s.economy.inflationFactor, 1.5);
});
