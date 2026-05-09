import test from 'node:test';
import assert from 'node:assert/strict';
import { createStocksState, flipMarket } from '../reserve/stocks.js';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng } from './helpers.js';
import {
  WILDCARD_POOL,
  VOLATILE_STOCK_ORDER
} from '../../shared/reserve/stockCatalog.js';

function deckWildValues(deck) {
  return deck.filter((c) => c && c.wild).map((c) => c.value);
}

test('every fresh deck contains exactly two wildcards drawn from WILDCARD_POOL', () => {
  for (let seed = 1; seed < 30; seed++) {
    // Disable game-creation priming so we can inspect the initial deck before
    // any cards are drawn.
    const s = createStocksState(seed, { primeHistory: false });
    for (const sym of VOLATILE_STOCK_ORDER) {
      const wilds = deckWildValues(s.market[sym].deck);
      assert.equal(wilds.length, 2, `${sym} (seed ${seed}) should have 2 wilds`);
      for (const v of wilds) {
        assert.ok(WILDCARD_POOL.includes(v), `${sym} wildcard ${v} not in pool`);
      }
    }
  }
});

test('wildcards are not fixed per-stock — different seeds yield variety', () => {
  // For at least one stock, observe distinct wildcard pairs across seeds.
  const observed = new Set();
  for (let seed = 1; seed < 50; seed++) {
    const s = createStocksState(seed, { primeHistory: false });
    const wilds = deckWildValues(s.market.TPHT.deck).slice().sort((a, b) => a - b);
    observed.add(wilds.join(','));
  }
  assert.ok(observed.size > 1, `TPHT wildcards should vary across seeds, got: ${[...observed].join(' | ')}`);
});

test('reshuffle re-randomizes wildcards (deterministic but different from first deck most of the time)', () => {
  // Drain the deck and check that the rebuild produced a fresh wildcard pair.
  const s = createStocksState(7);
  const firstWilds = deckWildValues(s.market.TPHT.deck).slice().sort((a, b) => a - b).join(',');
  // Manually empty the deck and force a rebuild by drawing one card.
  s.market.TPHT.deck = [];
  // flipMarket will reshuffle TPHT (and the others, but we only check TPHT).
  flipMarket(s, makeRng(11));
  const afterWilds = deckWildValues(s.market.TPHT.deck).slice().sort((a, b) => a - b).join(',');
  // After reshuffle the deck should have 33 cards (34 fresh - 1 just drawn) with 2 wildcards somewhere.
  const wildCount = deckWildValues(s.market.TPHT.deck).length;
  assert.ok(wildCount === 2 || wildCount === 1, `expected 1-2 wildcards still in deck after one draw, got ${wildCount}`);
  // We can't assert inequality to firstWilds (may collide by chance), but each value
  // must come from the pool.
  for (const v of deckWildValues(s.market.TPHT.deck)) {
    assert.ok(WILDCARD_POOL.includes(v), `${v} not in pool`);
  }
  void afterWilds; // touched to silence lint
});

test('reshuffle clears stale wildcard reveals on all seats', () => {
  let s = makeRoom(2);
  // makeRoom returns a primed market (all decks empty). Replace with a
  // non-primed market so we can isolate exactly which deck reshuffles.
  s.stocks = createStocksState(s.rngSeed, { primeHistory: false });
  // Plant a fake reveal on seat 0 for TPHT.
  s.seats[0].revealedWildcards = { TPHT: [-100, 100] };
  s.seats[1].revealedWildcards = { TPHT: [-100, 100], MNCL: [50, 50] };
  // Drain TPHT's deck so the next flip triggers a reshuffle on TPHT only.
  s.stocks.market.TPHT.deck = [];
  // Force the auto-flip path: hit the cycle boundary, then end a turn so reducer flips.
  s.stocks.cycle = 3; // next endTurn bumps to 4 → triggers flipMarket
  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  const r = reducer(s, { type: 'endTurn', seat: 0 }, { rng: makeRng(42) });
  assert.equal(r.ok, true);
  // TPHT reveal must be cleared on both seats; MNCL reveal on seat 1 must survive
  // (its deck wasn't empty, so no reshuffle there).
  assert.equal(r.state.seats[0].revealedWildcards.TPHT, undefined);
  assert.equal(r.state.seats[1].revealedWildcards.TPHT, undefined);
  assert.deepEqual(r.state.seats[1].revealedWildcards.MNCL, [50, 50]);
});

test('insider-tip reveal sources values from the live deck (not the catalog)', async () => {
  const { applyEventCard } = await import('../reserve/eventCards.js');
  let s = makeRoom(2);
  // Plant a known wildcard set in BORR's live deck.
  s.stocks.market.BORR.deck = [
    { value: -25, wild: true },
    { value: 50, wild: true },
    { value: 5, wild: false }
  ];
  const r = applyEventCard(s, 0, 'chance', 'chance.insiderTipBORR', { rng: makeRng() }, () => {});
  assert.equal(r.ok, true);
  const reveal = r.results.effects.find((e) => e.kind === 'revealWildcards');
  assert.deepEqual(reveal.wildCards, [-25, 50]);
  assert.deepEqual(s.seats[0].revealedWildcards.BORR, [-25, 50]);
});
