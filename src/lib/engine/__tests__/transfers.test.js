import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng } from './helpers.js';

function step(state, action, ctx = { rng: makeRng() }) {
  const r = reducer(state, action, ctx);
  if (!r.ok) throw new Error('reducer error: ' + r.error);
  return r.state;
}

// ---------- wireTransfer ----------

test('wireTransfer: moves cash instantly between seats', () => {
  let s = makeRoom(2, { cash: 500 });
  s = step(s, { type: 'wireTransfer', seat: 0, toSeat: 1, amount: 100 });
  assert.equal(s.seats[0].cash, 400);
  assert.equal(s.seats[1].cash, 600);
});

test('wireTransfer: rejects sending to self', () => {
  const s = makeRoom(2, { cash: 500 });
  const r = reducer(s, { type: 'wireTransfer', seat: 0, toSeat: 0, amount: 50 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'SAME_SEAT');
});

test('wireTransfer: rejects sub-zero amount', () => {
  const s = makeRoom(2, { cash: 500 });
  const r = reducer(s, { type: 'wireTransfer', seat: 0, toSeat: 1, amount: 0 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'BAD_AMOUNT');
});

test('wireTransfer: rejects when sender lacks funds', () => {
  const s = makeRoom(2, { cash: 50 });
  const r = reducer(s, { type: 'wireTransfer', seat: 0, toSeat: 1, amount: 100 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS');
});

// ---------- request flow ----------

test('requestTransfer: creates a pending request without moving cash', () => {
  let s = makeRoom(2, { cash: 500 });
  s = step(s, { type: 'requestTransfer', seat: 0, toSeat: 1, amount: 75, note: 'rent help' });
  assert.equal(s.pendingTransfers.length, 1);
  assert.equal(s.pendingTransfers[0].fromSeat, 0);
  assert.equal(s.pendingTransfers[0].toSeat, 1);
  assert.equal(s.pendingTransfers[0].amount, 75);
  assert.equal(s.pendingTransfers[0].note, 'rent help');
  // Cash unchanged
  assert.equal(s.seats[0].cash, 500);
  assert.equal(s.seats[1].cash, 500);
});

test('respondTransfer approve: moves cash from target to requester, removes request', () => {
  let s = makeRoom(2, { cash: 500 });
  s = step(s, { type: 'requestTransfer', seat: 0, toSeat: 1, amount: 75, note: '' });
  const id = s.pendingTransfers[0].id;
  s = step(s, { type: 'respondTransfer', seat: 1, requestId: id, approve: true });
  assert.equal(s.pendingTransfers.length, 0);
  assert.equal(s.seats[0].cash, 575);
  assert.equal(s.seats[1].cash, 425);
});

test('respondTransfer deny: removes request, no cash moves', () => {
  let s = makeRoom(2, { cash: 500 });
  s = step(s, { type: 'requestTransfer', seat: 0, toSeat: 1, amount: 75, note: '' });
  const id = s.pendingTransfers[0].id;
  s = step(s, { type: 'respondTransfer', seat: 1, requestId: id, approve: false });
  assert.equal(s.pendingTransfers.length, 0);
  assert.equal(s.seats[0].cash, 500);
  assert.equal(s.seats[1].cash, 500);
});

test('respondTransfer: only target seat can respond', () => {
  let s = makeRoom(3, { cash: 500 });
  s = step(s, { type: 'requestTransfer', seat: 0, toSeat: 1, amount: 75, note: '' });
  const id = s.pendingTransfers[0].id;
  // Seat 2 (not target) tries to approve.
  const r = reducer(s, { type: 'respondTransfer', seat: 2, requestId: id, approve: true }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NOT_TARGET');
});

test('cancelTransfer: requester removes their own pending request', () => {
  let s = makeRoom(2, { cash: 500 });
  s = step(s, { type: 'requestTransfer', seat: 0, toSeat: 1, amount: 75, note: '' });
  const id = s.pendingTransfers[0].id;
  s = step(s, { type: 'cancelTransfer', seat: 0, requestId: id });
  assert.equal(s.pendingTransfers.length, 0);
});

test('cancelTransfer: only requester can cancel', () => {
  let s = makeRoom(3, { cash: 500 });
  s = step(s, { type: 'requestTransfer', seat: 0, toSeat: 1, amount: 75, note: '' });
  const id = s.pendingTransfers[0].id;
  const r = reducer(s, { type: 'cancelTransfer', seat: 2, requestId: id }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NOT_REQUESTER');
});

test('respondTransfer approve: rejects when target lacks funds', () => {
  let s = makeRoom(2);
  s.seats[1].cash = 10;
  s = step(s, { type: 'requestTransfer', seat: 0, toSeat: 1, amount: 100, note: '' });
  const id = s.pendingTransfers[0].id;
  const r = reducer(s, { type: 'respondTransfer', seat: 1, requestId: id, approve: true }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS');
  // Request still pending — they can deny it instead.
  assert.equal(s.pendingTransfers.length, 1);
});

test('requestTransfer: caps at 3 pending per pair to prevent spam', () => {
  let s = makeRoom(2, { cash: 500 });
  for (let i = 0; i < 3; i++) {
    s = step(s, { type: 'requestTransfer', seat: 0, toSeat: 1, amount: 10, note: '' });
  }
  const r = reducer(s, { type: 'requestTransfer', seat: 0, toSeat: 1, amount: 10, note: '' }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'TOO_MANY_PENDING');
});
