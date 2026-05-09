import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng } from './helpers.js';
import {
  MARKET_OPEN_TOTAL_TICKS,
  MARKET_OPEN_TICK_INTERVAL_MS,
  startMarketOpen
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

test('Market Open scheduledFlips are deterministic for the same rngSeed', () => {
  // Pre-rolling exists specifically so the market window is replayable from
  // the seeded stream. Two rooms built with the same rngSeed (makeRoom hardcodes
  // rngSeed: 1) and triggered identically must produce byte-equal frames.
  const a = landOnMarketOpen(38, 4);
  const b = landOnMarketOpen(38, 4);
  assert.deepEqual(a.marketOpen.scheduledFlips, b.marketOpen.scheduledFlips);
});

test('startMarketOpen bumps rngCursor by exactly MARKET_OPEN_TOTAL_TICKS', () => {
  // The auto-flip path advances rngCursor by 1 per flip; Market Open pre-rolls
  // 34 flips at trigger time and must consume 34 cursor units in lockstep so
  // the two paths share one seeded stream without desyncing.
  const s = makeRoom(2);
  const before = s.rngCursor ?? 0;
  startMarketOpen(s, 0, { rng: makeRng() }, 4);
  assert.equal((s.rngCursor ?? 0) - before, MARKET_OPEN_TOTAL_TICKS);
});

test('startMarketOpen does NOT mutate live stocks (only ticks do)', () => {
  // The whole reason precomputeFlips works on a structuredClone shadow: the
  // player should see prices change *as* the window ticks, not jump instantly
  // when they land on the tile. Snapshot live state, trigger, assert no drift.
  const s = makeRoom(2);
  const before = Object.fromEntries(
    VOLATILE_STOCK_ORDER.map((sym) => [sym, {
      price: s.stocks.market[sym].price,
      deckLen: s.stocks.market[sym].deck.length,
      historyLen: s.stocks.market[sym].history.length
    }])
  );
  startMarketOpen(s, 0, { rng: makeRng() }, 4);
  for (const sym of VOLATILE_STOCK_ORDER) {
    assert.equal(s.stocks.market[sym].price, before[sym].price, `${sym} price moved at trigger`);
    assert.equal(s.stocks.market[sym].deck.length, before[sym].deckLen, `${sym} deck mutated at trigger`);
    assert.equal(s.stocks.market[sym].history.length, before[sym].historyLen, `${sym} history grew at trigger`);
  }
});

test('marketOpenTick applies scheduledFlips frame exactly to live stocks', () => {
  // Frame fidelity: tick N must copy scheduledFlips[N].pricesAfter onto live
  // m.price, push exactly one history entry equal to the new price, and set
  // m.lastCard / m.lastFlipPct to the frame's results value for that symbol.
  let s = landOnMarketOpen(38, 4);
  const planned = s.marketOpen.scheduledFlips[0];
  const histBefore = Object.fromEntries(
    VOLATILE_STOCK_ORDER.map((sym) => [sym, s.stocks.market[sym].history.length])
  );
  s = step(s, { type: 'marketOpenTick', _server: true });
  for (const sym of VOLATILE_STOCK_ORDER) {
    const m = s.stocks.market[sym];
    assert.equal(m.price, planned.pricesAfter[sym], `${sym} price != planned`);
    assert.equal(m.history.length, histBefore[sym] + 1, `${sym} history did not grow by 1`);
    assert.equal(m.history.at(-1), planned.pricesAfter[sym], `${sym} history tail != new price`);
    if (typeof planned.results[sym] === 'number') {
      assert.equal(m.lastCard, planned.results[sym], `${sym} lastCard != frame result`);
      assert.equal(m.lastFlipPct, planned.results[sym], `${sym} lastFlipPct != frame result`);
    }
  }
});

test('reshuffles during Market Open clear revealedWildcards on affected stocks only', () => {
  // When a stock's deck reshuffles mid-window, any insider-tip wildcard reveals
  // on that symbol become stale and must be wiped from every seat. Symbols not
  // reshuffled this tick must keep their reveals untouched.
  let s = landOnMarketOpen(38, 4);
  s.seats[0].revealedWildcards = Object.fromEntries(
    VOLATILE_STOCK_ORDER.map((sym) => [sym, [{ value: 25, position: 0 }]])
  );
  let sawReshuffle = false;
  for (let i = 0; i < MARKET_OPEN_TOTAL_TICKS; i++) {
    const frame = s.marketOpen.scheduledFlips[i];
    const reshuffledThisTick = new Set(frame.reshuffled ?? []);
    const survivors = VOLATILE_STOCK_ORDER.filter(
      (sym) => !reshuffledThisTick.has(sym) && s.seats[0].revealedWildcards[sym] !== undefined
    );
    s = step(s, { type: 'marketOpenTick', _server: true });
    if (reshuffledThisTick.size > 0) {
      sawReshuffle = true;
      for (const sym of reshuffledThisTick) {
        assert.equal(
          s.seats[0].revealedWildcards[sym], undefined,
          `${sym} revealedWildcards should be cleared after reshuffle on tick ${i}`
        );
      }
      for (const sym of survivors) {
        assert.notEqual(
          s.seats[0].revealedWildcards[sym], undefined,
          `${sym} revealedWildcards should NOT be cleared on tick ${i} (not reshuffled)`
        );
      }
    }
  }
  assert.ok(sawReshuffle, 'expected at least one reshuffle across 34 ticks (decks are 34 cards)');
});
