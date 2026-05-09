import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng } from './helpers.js';
import {
  STOCK_CATALOG,
  VOLATILE_STOCK_ORDER,
  FP500_SYMBOL,
  AUTO_FLIP_EVERY_N_TURNS
} from '../../shared/reserve/stockCatalog.js';
import { createStocksState, flipMarket, buyShares, sellShares, recalcFP500 } from '../reserve/stocks.js';

function step(state, action, ctx = { rng: makeRng() }) {
  const r = reducer(state, action, ctx);
  if (!r.ok) throw new Error('reducer error: ' + r.error);
  return r.state;
}

test('createStocksState (no priming) seeds catalog prices and FP500 history', () => {
  const s = createStocksState(0, { primeHistory: false });
  for (const sym of VOLATILE_STOCK_ORDER) {
    assert.equal(s.market[sym].price, STOCK_CATALOG[sym].start);
    assert.deepEqual(s.market[sym].history, [STOCK_CATALOG[sym].start]);
  }
  assert.equal(s.market[FP500_SYMBOL].price, STOCK_CATALOG[FP500_SYMBOL].start);
});

test('flipMarket draws one card per volatile stock and recomputes FP500', () => {
  const s = createStocksState();
  const before = { ...Object.fromEntries(VOLATILE_STOCK_ORDER.map((sym) => [sym, s.market[sym].price])) };
  const results = flipMarket(s, makeRng(7));
  for (const sym of VOLATILE_STOCK_ORDER) {
    assert.equal(typeof results[sym], 'number', sym + ' should have a result');
  }
  // Each stock has a non-empty deck after the draw (or refilled).
  for (const sym of VOLATILE_STOCK_ORDER) {
    assert.ok(s.market[sym].history.length >= 2);
  }
  // FP500 == average of the volatile prices (rounded to cents).
  recalcFP500(s);
  const avg =
    VOLATILE_STOCK_ORDER.reduce((acc, sym) => acc + s.market[sym].price, 0) /
    VOLATILE_STOCK_ORDER.length;
  assert.equal(s.market[FP500_SYMBOL].price, Math.max(0.01, Math.round(avg * 100) / 100));
});

test('buyShares moves cash to position and tracks cost basis', () => {
  const room = makeRoom(2);
  const seat = room.seats[0];
  // Stocks are now primed at room creation, so the live price differs from
  // the catalog start. Read it from the market.
  const price = room.stocks.market.TPHT.price;
  const expectedCost = Math.round(price * 3 * 100) / 100;
  const r = buyShares(seat, room.stocks, 'TPHT', 3);
  assert.equal(r.ok, true);
  assert.equal(r.qty, 3);
  assert.equal(seat.stockLots.TPHT, 3);
  assert.equal(seat.stockCostBasis.TPHT, expectedCost);
  assert.equal(seat.cash, Math.round((1500 - expectedCost) * 100) / 100);
});

test('sellShares reduces position and returns proceeds; basis is proportional', () => {
  const room = makeRoom(2);
  const seat = room.seats[0];
  const price = room.stocks.market.TPHT.price;
  const buyCost = Math.round(price * 4 * 100) / 100;
  buyShares(seat, room.stocks, 'TPHT', 4);
  const cashAfterBuy = seat.cash;
  const r = sellShares(seat, room.stocks, 'TPHT', 2);
  assert.equal(r.ok, true);
  assert.equal(seat.stockLots.TPHT, 2);
  // Selling half the position removes half the basis.
  assert.equal(seat.stockCostBasis.TPHT, Math.round((buyCost / 2) * 100) / 100);
  assert.equal(seat.cash, Math.round((cashAfterBuy + price * 2) * 100) / 100);
});

test('reducer buyStock action: only non-bankrupt seats can buy', () => {
  let s = makeRoom(2);
  s.seats[0].bankrupt = true;
  const r = reducer(s, { type: 'buyStock', seat: 0, symbol: 'TPHT', qty: 1 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'BANKRUPT');
});

test('reducer rejects removed manual-banker actions', () => {
  let s = makeRoom(2);
  const r = reducer(s, { type: 'bankerFlipMarket', seat: 0 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'UNKNOWN_ACTION');
});

test('the market flips every AUTO_FLIP_EVERY_N_TURNS turns', () => {
  let s = makeRoom(2);
  s.stocks.cycle = 0;
  const ctx = { rng: makeRng(99) };
  const initial = { ...Object.fromEntries(VOLATILE_STOCK_ORDER.map((sym) => [sym, s.stocks.market[sym].price])) };

  for (let i = 0; i < AUTO_FLIP_EVERY_N_TURNS; i++) {
    s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
    s = step(s, { type: 'endTurn', seat: 0 }, ctx);
    // After endTurn the next seat's preRoll begins; bring back to seat 0 for next iteration.
    if (s.turn.seat !== 0) {
      s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
    }
  }
  // At least one stock should have moved from its initial price.
  const moved = VOLATILE_STOCK_ORDER.some((sym) => s.stocks.market[sym].price !== initial[sym]);
  assert.ok(moved, 'expected at least one stock to flip after auto cadence');
  assert.ok(s.stocks.cycle >= AUTO_FLIP_EVERY_N_TURNS);
});
