import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng, step } from './helpers.js';
import {
  AUCTION_ATTEMPT_FRACTIONS,
  startPriceForAttempt,
  createAuction
} from '../auction.js';
import { BOARD } from '../../shared/board.js';

test('AUCTION_ATTEMPT_FRACTIONS sequences 50% → 25% → 0', () => {
  assert.deepEqual(AUCTION_ATTEMPT_FRACTIONS, [0.5, 0.25, 0]);
});

test('startPriceForAttempt: spec example for $400 Boardwalk', () => {
  assert.equal(startPriceForAttempt(39, 0), 200);
  assert.equal(startPriceForAttempt(39, 1), 100);
  assert.equal(startPriceForAttempt(39, 2), 0);
});

test('createAuction(spaceIndex, attempt) sets startPrice from attempt fraction', () => {
  const a = createAuction(39, 1, 1000);
  assert.equal(a.attempt, 1);
  assert.equal(a.startPrice, Math.round(BOARD[39].price * 0.25 * 100) / 100);
});

test('cascading: no-bid auctionTick advances to attempt 1 with 25% start', () => {
  let s = makeRoom(2);
  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s.pendingAuctions = [{ spaceIndex: 39, declinedBy: 0 }];
  s = step(s, { type: 'endTurn', seat: 0 });
  assert.equal(s.pendingAction.attempt, 0);
  assert.equal(s.pendingAction.startPrice, 200);
  s.pendingAction.endsAtMs = Date.now() - 1;
  s = step(s, { type: 'auctionTick', _server: true });
  assert.equal(s.pendingAction.type, 'auction');
  assert.equal(s.pendingAction.attempt, 1);
  assert.equal(s.pendingAction.startPrice, 100);
});

test('cascading: two no-bid expirations → attempt 2 at $0', () => {
  let s = makeRoom(2);
  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s.pendingAuctions = [{ spaceIndex: 39, declinedBy: 0 }];
  s = step(s, { type: 'endTurn', seat: 0 });
  s.pendingAction.endsAtMs = Date.now() - 1;
  s = step(s, { type: 'auctionTick', _server: true });
  s.pendingAction.endsAtMs = Date.now() - 1;
  s = step(s, { type: 'auctionTick', _server: true });
  assert.equal(s.pendingAction.attempt, 2);
  assert.equal(s.pendingAction.startPrice, 0);
});

test('cascading: three no-bid expirations → random assign and auction ends', () => {
  let s = makeRoom(2);
  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s.pendingAuctions = [{ spaceIndex: 39, declinedBy: 0 }];
  s = step(s, { type: 'endTurn', seat: 0 });
  s.pendingAction.endsAtMs = Date.now() - 1;
  s = step(s, { type: 'auctionTick', _server: true });
  s.pendingAction.endsAtMs = Date.now() - 1;
  s = step(s, { type: 'auctionTick', _server: true });
  s.pendingAction.endsAtMs = Date.now() - 1;
  s = step(s, { type: 'auctionTick', _server: true }, { rng: () => 0 });
  assert.equal(s.pendingAction, null);
  assert.notEqual(s.properties[39].ownerSeat, null);
});

test('cascading: bid at attempt 1 settles normally', () => {
  let s = makeRoom(2);
  s.seats[1].cash = 0;
  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s.pendingAuctions = [{ spaceIndex: 39, declinedBy: 0 }];
  s = step(s, { type: 'endTurn', seat: 0 });
  s.pendingAction.endsAtMs = Date.now() - 1;
  s = step(s, { type: 'auctionTick', _server: true });
  assert.equal(s.pendingAction.attempt, 1);
  assert.equal(s.pendingAction.startPrice, 100);
  s = step(s, { type: 'bid', seat: 0, amount: 100 });
  assert.equal(s.pendingAction, null);
  assert.equal(s.properties[39].ownerSeat, 0);
});

test('first bid must be at least startPrice', () => {
  let s = makeRoom(2);
  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s.pendingAuctions = [{ spaceIndex: 39, declinedBy: 0 }];
  s = step(s, { type: 'endTurn', seat: 0 });
  const r = reducer(s, { type: 'bid', seat: 0, amount: 199 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'BID_TOO_LOW');
});
