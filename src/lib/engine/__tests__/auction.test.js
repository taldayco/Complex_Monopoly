import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng } from './helpers.js';
import { AUCTION_DURATION_MS } from '../../shared/constants.js';

function step(state, action, ctx = { rng: makeRng() }) {
  const r = reducer(state, action, ctx);
  if (!r.ok) throw new Error('reducer error: ' + r.error);
  return r.state;
}

function setEndable(s, seat = 0) {
  s.turn = { seat, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
}

test('end turn drains pendingAuctions and starts a live auction', () => {
  let s = makeRoom(2);
  setEndable(s, 0);
  s.pendingAuctions = [{ spaceIndex: 1, declinedBy: 0, reason: 'declined' }];
  s = step(s, { type: 'endTurn', seat: 0 });
  assert.equal(s.pendingAction?.type, 'auction');
  assert.equal(s.pendingAction.spaceIndex, 1);
  assert.equal(s.pendingAction.currentBid, 0);
  assert.equal(s.pendingAction.highBidder, null);
  assert.ok(s.pendingAction.endsAtMs > Date.now());
  assert.equal(s.pendingAuctions.length, 0);
  // Turn has NOT advanced yet — still seat 0 until the auction settles.
  assert.equal(s.turn.seat, 0);
  assert.equal(s.turn.phase, 'resolving');
});

test('any non-bankrupt seat can bid (free-for-all)', () => {
  let s = makeRoom(3);
  setEndable(s, 0);
  s.pendingAuctions = [{ spaceIndex: 1, declinedBy: 0 }];
  s = step(s, { type: 'endTurn', seat: 0 });
  // Seat 2 (not the player who triggered the auction) bids first.
  s = step(s, { type: 'bid', seat: 2, amount: 50 });
  assert.equal(s.pendingAction.currentBid, 50);
  assert.equal(s.pendingAction.highBidder, 2);
});

test('each accepted bid resets endsAtMs to ~now+AUCTION_DURATION_MS', async () => {
  let s = makeRoom(3);
  setEndable(s, 0);
  s.pendingAuctions = [{ spaceIndex: 1, declinedBy: 0 }];
  s = step(s, { type: 'endTurn', seat: 0 });
  const initialEnds = s.pendingAction.endsAtMs;

  // Wait a tick so the timer reset is observable.
  await new Promise((r) => setTimeout(r, 5));
  s = step(s, { type: 'bid', seat: 1, amount: 5 });
  assert.ok(s.pendingAction.endsAtMs > initialEnds, 'endsAtMs should advance');
  assert.ok(s.pendingAction.endsAtMs >= Date.now() + AUCTION_DURATION_MS - 50);
});

test('auction settles early when only one seat can still afford the next bid', () => {
  let s = makeRoom(3);
  // Seats 1 and 2 are nearly broke; seat 0 has plenty.
  s.seats[0].cash = 1000;
  s.seats[1].cash = 5;
  s.seats[2].cash = 5;
  setEndable(s, 0);
  s.pendingAuctions = [{ spaceIndex: 1, declinedBy: 0 }];
  s = step(s, { type: 'endTurn', seat: 0 });

  // Seat 0 bids $20 — neither seat 1 nor seat 2 can outbid (need ≥21, have $5).
  // Only seat 0 (the high bidder) can afford the next min bid → settle early.
  s = step(s, { type: 'bid', seat: 0, amount: 20 });
  assert.equal(s.pendingAction, null, 'auction should have settled');
  assert.equal(s.properties[1].ownerSeat, 0);
  assert.equal(s.seats[0].cash, 1000 - 20);
  // Turn advanced after settlement.
  assert.equal(s.turn.seat, 1);
  assert.equal(s.turn.phase, 'preRoll');
});

test('expired auctionTick with no bids leaves the property unowned', () => {
  let s = makeRoom(3);
  setEndable(s, 0);
  s.pendingAuctions = [{ spaceIndex: 1, declinedBy: 0 }];
  s = step(s, { type: 'endTurn', seat: 0 });
  // Force the timer to be in the past so isExpired() returns true.
  s.pendingAction.endsAtMs = Date.now() - 1;
  s = step(s, { type: 'auctionTick', _server: true });
  assert.equal(s.pendingAction, null);
  assert.equal(s.properties[1].ownerSeat, null);
  // Turn advances to seat 1 since no doubles were rolled.
  assert.equal(s.turn.seat, 1);
});

test('client-injected auctionTick is rejected (server-only)', () => {
  let s = makeRoom(2);
  setEndable(s, 0);
  s.pendingAuctions = [{ spaceIndex: 1, declinedBy: 0 }];
  s = step(s, { type: 'endTurn', seat: 0 });
  // Without _server: true the tick must be rejected.
  const r = reducer(s, { type: 'auctionTick' }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'CLIENT_TICK');
});

test('chained auctions: queue with multiple entries drains one at a time', () => {
  let s = makeRoom(2);
  setEndable(s, 0);
  s.pendingAuctions = [
    { spaceIndex: 1, declinedBy: 0 },
    { spaceIndex: 3, declinedBy: 0 }
  ];
  // First end-turn starts auction for space 1.
  s = step(s, { type: 'endTurn', seat: 0 });
  assert.equal(s.pendingAction.spaceIndex, 1);
  assert.equal(s.pendingAuctions.length, 1);

  // Settle by expiring with no bids. After settlement the next auction starts.
  s.pendingAction.endsAtMs = Date.now() - 1;
  s = step(s, { type: 'auctionTick', _server: true });
  assert.equal(s.pendingAction.type, 'auction', 'second auction should start');
  assert.equal(s.pendingAction.spaceIndex, 3);
  assert.equal(s.pendingAuctions.length, 0);

  // Settle the second auction the same way; turn finally advances.
  s.pendingAction.endsAtMs = Date.now() - 1;
  s = step(s, { type: 'auctionTick', _server: true });
  assert.equal(s.pendingAction, null);
  assert.equal(s.turn.seat, 1);
});

test('insufficient funds at landing queues an auction directly (no buyDecision)', () => {
  let s = makeRoom(2, { cash: 50 });
  // Force a known dice roll: 0.0 + 0.5 → 1 + 4 = 5 (Reading Railroad, $200, > $50 cash).
  const rolls = [0.0, 0.5];
  let i = 0;
  const rng = () => rolls[i++ % rolls.length];
  s = step(s, { type: 'rollDice', seat: 0 }, { rng });
  assert.equal(s.seats[0].position, 5);
  assert.equal(s.pendingAction, null, 'no buyDecision should be created');
  assert.equal(s.pendingAuctions.length, 1);
  assert.equal(s.pendingAuctions[0].spaceIndex, 5);
  assert.equal(s.pendingAuctions[0].reason, 'insufficientFunds');
});

test('bid below the minimum is rejected', () => {
  let s = makeRoom(2);
  setEndable(s, 0);
  s.pendingAuctions = [{ spaceIndex: 1, declinedBy: 0 }];
  s = step(s, { type: 'endTurn', seat: 0 });
  s = step(s, { type: 'bid', seat: 1, amount: 50 });
  // Seat 0 tries to bid 50 (equal, not higher) → BID_TOO_LOW.
  const r = reducer(s, { type: 'bid', seat: 0, amount: 50 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'BID_TOO_LOW');
});

test('bid that exceeds bidder cash is rejected', () => {
  let s = makeRoom(2);
  s.seats[1].cash = 30;
  setEndable(s, 0);
  s.pendingAuctions = [{ spaceIndex: 1, declinedBy: 0 }];
  s = step(s, { type: 'endTurn', seat: 0 });
  const r = reducer(s, { type: 'bid', seat: 1, amount: 100 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS');
});

test('auction with doubles roll-again preserved after settlement', () => {
  let s = makeRoom(2);
  // Last roll was doubles → after auction settlement, the same seat rolls again.
  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 3], doublesCount: 1 };
  s.pendingAuctions = [{ spaceIndex: 1, declinedBy: 0 }];
  s = step(s, { type: 'endTurn', seat: 0 });
  // Expire with no bids.
  s.pendingAction.endsAtMs = Date.now() - 1;
  s = step(s, { type: 'auctionTick', _server: true });
  // Same seat, ready to roll again.
  assert.equal(s.turn.seat, 0);
  assert.equal(s.turn.phase, 'preRoll');
});
