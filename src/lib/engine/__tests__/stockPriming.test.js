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

test('regression: stocks do NOT crash to $0.01 across seeds — multiplicative bug fix', () => {
  // The original bug: multiplicative `price * (1 + pct/100)` math meant the
  // -100 BASE card multiplied price by 0, dropping it to the $0.01 floor
  // permanently. Every primed stock ended at $0.01-ish. With additive-against-
  // start math, even floor hits recover (subsequent positive cards add an
  // absolute dollar amount, not a multiple of current). Sample a bunch of seeds
  // and assert the geometric mean is well above the floor.
  const samples = [];
  for (let seed = 1; seed <= 30; seed++) {
    const s = createStocksState(seed);
    for (const sym of VOLATILE_STOCK_ORDER) {
      samples.push(s.market[sym].price / s.market[sym].startPrice);
    }
  }
  const aboveDollar = samples.filter((r) => r > 0.05).length;
  // With multiplicative math + the -100 card, virtually all samples crashed to
  // <2% of start. With additive math, the vast majority should be well above.
  assert.ok(
    aboveDollar / samples.length > 0.9,
    `expected >90% of samples above 5% of start, got ${aboveDollar}/${samples.length}`
  );
});

test('expected value of primed price ≈ start × 1.15 (BASE deck sum + zero-mean wildcards)', () => {
  // The deck sum is BASE_SUM (+15) + wildcards drawn from a zero-mean pool.
  // Across enough seeds, the mean primed price should approach start * 1.15.
  // Additive math + floor clamp introduces a small upward bias (clamp absorbs
  // negative tails), so allow generous tolerance.
  const N = 80;
  const ratios = [];
  for (let seed = 1; seed <= N; seed++) {
    const s = createStocksState(seed);
    for (const sym of VOLATILE_STOCK_ORDER) {
      ratios.push(s.market[sym].price / s.market[sym].startPrice);
    }
  }
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  // Center is +15%; clamp adds a bit of upward bias. Should be in [0.9, 2.0].
  assert.ok(mean > 0.9, `mean ratio ${mean.toFixed(2)} too low — bug may not be fixed`);
  assert.ok(mean < 2.0, `mean ratio ${mean.toFixed(2)} suspiciously high`);
});

test('with wildcards forced to sum to 0 and no -100 base hits, final = start × 1.15 exactly', () => {
  // Use a controlled deck order where the running sum × startPrice never
  // dips below zero, so no clamping happens and the additive invariant is
  // exact: final = start × (1 + sum/100) = start × 1.15.
  const s = createStocksState(0, { primeHistory: false });
  for (const sym of VOLATILE_STOCK_ORDER) {
    const m = s.market[sym];
    // Sort cards from largest positive to most negative — keeps the running
    // total above zero so the floor-clamp never kicks in.
    const baseCards = m.deck
      .filter((c) => !c.wild)
      .slice()
      .sort((a, b) => b.value - a.value);
    m.deck = [
      ...baseCards,
      { value: 25, wild: true },
      { value: -25, wild: true }
    ];
  }
  primeStockHistory(s);
  for (const sym of VOLATILE_STOCK_ORDER) {
    const m = s.market[sym];
    const expected = Math.round(m.startPrice * 1.15 * 100) / 100;
    assert.equal(
      m.price, expected,
      `${sym}: expected ${expected}, got ${m.price}`
    );
  }
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
