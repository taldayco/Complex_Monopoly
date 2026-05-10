import test from 'node:test';
import assert from 'node:assert/strict';
import { accrueCardInterest } from '../reserve/cards.js';

function seatWithCard(cardId, balance) {
  return {
    seat: 0,
    creditCards: [{ id: 'CC-1', cardId, status: 'active', balance, acquiredAt: 0 }]
  };
}

test('accrueCardInterest gates on turnCount % 4 === 0', () => {
  const s = seatWithCard('vaultPlatinum', 1000);
  const e1 = accrueCardInterest([s], 3, 0);
  assert.equal(e1.length, 0);
  assert.equal(s.creditCards[0].balance, 1000);
  const e2 = accrueCardInterest([s], 4, 0);
  assert.equal(e2.length, 1);
  assert.equal(s.creditCards[0].balance, 1200);
});

test('accrueCardInterest scales with reserveRate', () => {
  const a = seatWithCard('vaultPlatinum', 1000);
  const b = seatWithCard('vaultPlatinum', 1000);
  accrueCardInterest([a], 4, 0);
  accrueCardInterest([b], 4, 0.05);
  assert.equal(a.creditCards[0].balance, 1200);
  assert.equal(b.creditCards[0].balance, 1250);
});

test('accrueCardInterest effective rate floors at 0 when reserve is deeply negative', () => {
  const s = seatWithCard('vaultPlatinum', 1000);
  const e = accrueCardInterest([s], 4, -0.25);
  assert.equal(e.length, 1);
  assert.equal(e[0].effectiveRate, 0);
  assert.equal(e[0].interest, 0);
  assert.equal(s.creditCards[0].balance, 1000);
});

test('accrueCardInterest emits effectiveRate in the event payload', () => {
  const s = seatWithCard('vaultPlatinum', 500);
  const events = accrueCardInterest([s], 4, 0.04);
  assert.equal(events.length, 1);
  const ev = events[0];
  assert.equal(ev.baseRate, 0.20);
  assert.equal(ev.reserveRate, 0.04);
  assert.ok(Math.abs(ev.effectiveRate - 0.24) < 1e-9);
  assert.equal(ev.interest, 120);
});

test('accrueCardInterest skips cards with zero balance and inactive cards', () => {
  const s1 = seatWithCard('vaultPlatinum', 0);
  const s2 = seatWithCard('vaultPlatinum', 1000);
  s2.creditCards[0].status = 'cancelled';
  const e = accrueCardInterest([s1, s2], 4, 0);
  assert.equal(e.length, 0);
});
