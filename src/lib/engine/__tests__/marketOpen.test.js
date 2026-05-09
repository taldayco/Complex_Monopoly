import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng } from './helpers.js';
import {
  MARKET_OPEN_TOTAL_TICKS,
  MARKET_OPEN_TICK_INTERVAL_MS
} from '../reserve/marketOpen.js';
import { VOLATILE_STOCK_ORDER } from '../../shared/reserve/stockCatalog.js';

function step(state, action, ctx = { rng: makeRng() }) {
  const r = reducer(state, action, ctx);
  if (!r.ok) throw new Error('reducer error: ' + r.error);
  return r.state;
}

function landOnMarketOpen(seatStartPosition, expectedTile) {
  let s = makeRoom(2);
  s.seats[0].position = seatStartPosition;
  // rng=0.34 → dice 3+3=6 doubles. Choose start so 38→4, 14→20, 32→38.
  const rng = () => 0.34;
  s = step(s, { type: 'rollDice', seat: 0 }, { rng });
  assert.equal(s.seats[0].position, expectedTile);
  return s;
}

test('landing on Market Open tile activates the window', () => {
  const s = landOnMarketOpen(38, 4);
  assert.ok(s.marketOpen, 'state.marketOpen should be set');
  assert.equal(s.marketOpen.active, true);
  assert.equal(s.marketOpen.totalTicks, MARKET_OPEN_TOTAL_TICKS);
  assert.equal(s.marketOpen.ticksFired, 0);
  assert.equal(s.marketOpen.triggerSeat, 0);
  assert.equal(s.marketOpen.triggerSpaceIndex, 4);
  assert.equal(
    s.marketOpen.endsAtMs - s.marketOpen.startedAtMs,
    MARKET_OPEN_TOTAL_TICKS * MARKET_OPEN_TICK_INTERVAL_MS
  );
  assert.ok(Array.isArray(s.marketOpen.scheduledFlips));
  assert.equal(s.marketOpen.scheduledFlips.length, MARKET_OPEN_TOTAL_TICKS);
});

test('all three classic tax/free-parking indices trigger Market Open', () => {
  // 38 + 6 = 4
  assert.ok(landOnMarketOpen(38, 4).marketOpen);
  // 14 + 6 = 20
  assert.ok(landOnMarketOpen(14, 20).marketOpen);
  // 32 + 6 = 38
  assert.ok(landOnMarketOpen(32, 38).marketOpen);
});

test('Market Open blocks rollDice / endTurn but allows buy/sell stock', () => {
  let s = landOnMarketOpen(38, 4);
  // Other player tries to roll — should be blocked.
  s.turn.seat = 1;
  s.turn.phase = 'preRoll';
  let r = reducer(s, { type: 'rollDice', seat: 1 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'MARKET_OPEN_ACTIVE');
  // End turn likewise blocked.
  s.turn.seat = 0;
  s.turn.phase = 'endable';
  r = reducer(s, { type: 'endTurn', seat: 0 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'MARKET_OPEN_ACTIVE');
  // Buy stock should pass through.
  r = reducer(s, { type: 'buyStock', seat: 1, symbol: 'TPHT', qty: 1 }, { rng: makeRng() });
  assert.equal(r.ok, true);
});

test('marketOpenTick requires _server flag', () => {
  const s = landOnMarketOpen(38, 4);
  const r = reducer(s, { type: 'marketOpenTick' }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NOT_AUTHORIZED');
});

test('each marketOpenTick advances ticksFired and changes prices', () => {
  let s = landOnMarketOpen(38, 4);
  const initialPrices = Object.fromEntries(
    VOLATILE_STOCK_ORDER.map((sym) => [sym, s.stocks.market[sym].price])
  );
  s = step(s, { type: 'marketOpenTick', _server: true });
  assert.equal(s.marketOpen.ticksFired, 1);
  // At least one volatile stock should have moved (with overwhelming probability).
  const moved = VOLATILE_STOCK_ORDER.some(
    (sym) => s.stocks.market[sym].price !== initialPrices[sym]
  );
  assert.ok(moved, 'at least one stock should change after a tick');
});

test('Market Open clears after the final tick', () => {
  let s = landOnMarketOpen(38, 4);
  for (let i = 0; i < MARKET_OPEN_TOTAL_TICKS; i++) {
    s = step(s, { type: 'marketOpenTick', _server: true });
  }
  assert.equal(s.marketOpen, null);
  // Now non-trading actions should work again.
  s.turn.seat = 0;
  s.turn.phase = 'endable';
  // doublesCount was incremented by the rollDice on doubles, so endTurn either
  // re-rolls or advances; either way it must NOT be MARKET_OPEN_ACTIVE.
  const r = reducer(s, { type: 'endTurn', seat: 0 }, { rng: makeRng() });
  assert.equal(r.ok, true);
});

test('Market Open emits start, tick, scheduled, and end events', () => {
  let s = makeRoom(2);
  s.seats[0].position = 38;
  const rng = () => 0.34;
  let r = reducer(s, { type: 'rollDice', seat: 0 }, { rng });
  assert.equal(r.ok, true);
  s = r.state;
  const startEvent = r.events.find((e) => e.type === 'marketOpenStart');
  assert.ok(startEvent, 'expected marketOpenStart event');
  assert.equal(startEvent.payload.totalTicks, MARKET_OPEN_TOTAL_TICKS);
  assert.equal(typeof startEvent.payload.nextTickAtMs, 'number');

  // First tick: should emit marketTickScheduled (not yet end).
  r = reducer(s, { type: 'marketOpenTick', _server: true }, { rng: makeRng() });
  assert.equal(r.ok, true);
  s = r.state;
  assert.ok(r.events.find((e) => e.type === 'marketOpenTick'));
  assert.ok(r.events.find((e) => e.type === 'marketTickScheduled'));
  assert.ok(!r.events.find((e) => e.type === 'marketOpenEnd'));

  // Final tick: should emit marketOpenEnd.
  for (let i = 1; i < MARKET_OPEN_TOTAL_TICKS - 1; i++) {
    r = reducer(s, { type: 'marketOpenTick', _server: true }, { rng: makeRng() });
    s = r.state;
  }
  r = reducer(s, { type: 'marketOpenTick', _server: true }, { rng: makeRng() });
  assert.equal(r.ok, true);
  assert.ok(r.events.find((e) => e.type === 'marketOpenEnd'));
  assert.equal(r.state.marketOpen, null);
});
