import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STOCK_CATALOG,
  VOLATILE_STOCK_ORDER,
  FP500_SYMBOL,
  BASE_CARDS,
  WILDCARD_POOL
} from '../../shared/reserve/stockCatalog.js';
import { createStocksState, primeStockHistory } from '../reserve/stocks.js';

const TICKS = BASE_CARDS.length + 2; // 34

test('priming consumes the full initial deck for every volatile stock', () => {
  const s = createStocksState(12345);
  for (const sym of VOLATILE_STOCK_ORDER) {
    assert.equal(s.market[sym].deck.length, 0, `${sym} deck should be empty after priming`);
    // history starts with the catalog start price plus one entry per tick.
    assert.equal(s.market[sym].history.length, 1 + TICKS, `${sym} history length`);
  }
});

test('priming builds an FP500 history with matching length', () => {
  const s = createStocksState(7);
  assert.equal(s.market[FP500_SYMBOL].history.length, 1 + TICKS);
});

test('priming does NOT touch round/cycle/lastFlip', () => {
  const s = createStocksState(42);
  assert.equal(s.round, 0);
  assert.equal(s.cycle, 0);
  assert.equal(s.lastFlip, null);
});

test('primed prices are positive and respect the $0.01 floor', () => {
  const s = createStocksState(99);
  for (const sym of VOLATILE_STOCK_ORDER) {
    assert.ok(s.market[sym].price >= 0.01, `${sym} price must be >= 0.01`);
    assert.ok(Number.isFinite(s.market[sym].price));
  }
  assert.ok(s.market[FP500_SYMBOL].price >= 0.01);
});

test('different rngSeeds produce different starting prices', () => {
  const a = createStocksState(1);
  const b = createStocksState(2);
  // It would be a vanishing-probability collision for ALL five stocks to land
  // on the same price under different seeds; assert at least one differs.
  const someDiffer = VOLATILE_STOCK_ORDER.some(
    (sym) => a.market[sym].price !== b.market[sym].price
  );
  assert.ok(someDiffer, 'expected at least one stock to differ between seeds');
});

test('primed prices generally diverge from catalog start prices', () => {
  // The catalog start values are seed-independent; after 34 random draws, at
  // least one stock should have moved off its start. (Vanishingly unlikely
  // for all five to land back exactly on start.)
  const s = createStocksState(2026);
  const moved = VOLATILE_STOCK_ORDER.some(
    (sym) => s.market[sym].price !== STOCK_CATALOG[sym].start
  );
  assert.ok(moved, 'expected some stock to have moved during priming');
});

test('opt-out: createStocksState(seed, { primeHistory: false }) leaves stocks at catalog start', () => {
  const s = createStocksState(0, { primeHistory: false });
  for (const sym of VOLATILE_STOCK_ORDER) {
    assert.equal(s.market[sym].price, STOCK_CATALOG[sym].start);
    assert.deepEqual(s.market[sym].history, [STOCK_CATALOG[sym].start]);
    assert.equal(s.market[sym].deck.length, TICKS);
  }
});

test('priming uses random wildcards from the pool — variation across seeds', () => {
  // Build a non-primed state for several seeds, peek at the wildcards in
  // each deck (they're flagged wild:true), and confirm we see at least two
  // different wildcard values across seeds for at least one stock.
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const wildsPerSeed = seeds.map((seed) => {
    const s = createStocksState(seed, { primeHistory: false });
    const out = {};
    for (const sym of VOLATILE_STOCK_ORDER) {
      out[sym] = s.market[sym].deck.filter((c) => c.wild).map((c) => c.value);
      // every wildcard value is from the pool
      for (const v of out[sym]) {
        assert.ok(WILDCARD_POOL.includes(v), `${sym} wildcard ${v} must be in pool`);
      }
      assert.equal(out[sym].length, 2, `${sym} should have exactly 2 wildcards`);
    }
    return out;
  });

  // At least one stock must show >1 distinct wildcard set across the sampled seeds.
  const sawVariation = VOLATILE_STOCK_ORDER.some((sym) => {
    const set = new Set(wildsPerSeed.map((row) => row[sym].join(',')));
    return set.size > 1;
  });
  assert.ok(sawVariation, 'expected wildcard variation across seeds for some stock');
});

test('primeStockHistory is idempotent on an already-empty deck (no-op)', () => {
  const s = createStocksState(50); // already primed → decks empty
  const histBefore = VOLATILE_STOCK_ORDER.map((sym) => s.market[sym].history.length);
  primeStockHistory(s);
  const histAfter = VOLATILE_STOCK_ORDER.map((sym) => s.market[sym].history.length);
  assert.deepEqual(histAfter, histBefore, 're-priming an empty deck should add no history');
});
