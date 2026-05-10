import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng } from './helpers.js';
import {
  createEconomyState,
  hydrateEconomy,
  flipEconomy
} from '../reserve/economy.js';
import {
  STARTING_RESERVE_RATE,
  STARTING_INFLATION,
  RESERVE_FLOOR,
  BASE_INF_INT_DECK,
  INF_INT_WILDCARD_POOL
} from '../../shared/reserve/economyCatalog.js';

function step(state, action, ctx) {
  const r = reducer(state, action, ctx);
  if (!r.ok) throw new Error('reducer error: ' + r.error + ' on ' + action.type);
  return { state: r.state, events: r.events };
}


test('createEconomyState seeds 32+2 cards with two wildcards in play', () => {
  const e = createEconomyState(123);
  assert.equal(e.reserveRate, STARTING_RESERVE_RATE);
  assert.equal(e.inflationFactor, STARTING_INFLATION);
  assert.equal(e.deck.length, BASE_INF_INT_DECK.length + 2);
  assert.equal(e.wildPool.length, 2);
  for (const w of e.wildPool) {
    assert.ok(
      INF_INT_WILDCARD_POOL.some((p) => p.inf === w.inf && p.int === w.int),
      'wildcard ' + JSON.stringify(w) + ' must be from the pool'
    );
  }
});

test('createEconomyState is deterministic for the same seed', () => {
  const a = createEconomyState(7);
  const b = createEconomyState(7);
  assert.deepEqual(a.deck, b.deck);
  assert.deepEqual(a.wildPool, b.wildPool);
});

test('hydrateEconomy is idempotent and rebuilds an empty deck', () => {
  const e = createEconomyState(99);
  hydrateEconomy(e, 99);
  assert.equal(e.deck.length, BASE_INF_INT_DECK.length + 2);
  e.deck = [];
  e.wildPool = [];
  hydrateEconomy(e, 99);
  assert.equal(e.deck.length, BASE_INF_INT_DECK.length + 2);
});


test('flipEconomy applies inflation always; INT clamps at 0% with intIgnored', () => {
  const e = createEconomyState(1);
  e.reserveRate = 0;
  e.deck = [{ inf: 0.005, int: -0.005, wild: false }];
  const before = e.inflationFactor;
  const result = flipEconomy(e, () => 0);
  assert.equal(result.intIgnored, true);
  assert.equal(e.reserveRate, RESERVE_FLOOR);
  assert.ok(e.inflationFactor > before, 'inflation must apply on intIgnored card');
});

test('flipEconomy normal positive card raises both reserve and inflation', () => {
  const e = createEconomyState(1);
  e.reserveRate = 0.03;
  e.deck = [{ inf: 0.002, int: 0.0025, wild: false }];
  const before = { rate: e.reserveRate, infl: e.inflationFactor };
  flipEconomy(e, () => 0);
  assert.ok(e.reserveRate > before.rate);
  assert.ok(e.inflationFactor > before.infl);
});

test('flipEconomy reshuffles when the deck empties; new wildcards drawn from pool', () => {
  const e = createEconomyState(2);
  while (e.deck.length > 0) flipEconomy(e, () => 0.5);
  const oldWilds = JSON.parse(JSON.stringify(e.wildPool));
  const result = flipEconomy(e, () => 0.123);
  assert.equal(result.reshuffled, true);
  assert.equal(e.deck.length, BASE_INF_INT_DECK.length + 2 - 1, 'one card already drawn after reshuffle');
  for (const w of e.wildPool) {
    assert.ok(
      INF_INT_WILDCARD_POOL.some((p) => p.inf === w.inf && p.int === w.int)
    );
  }
});


test('endTurn flips the economy once, advancing reserveRate or inflation', () => {
  let s = makeRoom(2);
  s.economy.deck = [{ inf: 0.002, int: 0.0025, wild: false }, ...s.economy.deck];
  const ctx = { rng: makeRng(11) };
  const before = { rate: s.economy.reserveRate, infl: s.economy.inflationFactor };
  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  const r = step(s, { type: 'endTurn', seat: 0 }, ctx);
  s = r.state;
  assert.ok(s.economy.reserveRate >= before.rate);
  assert.ok(s.economy.inflationFactor >= before.infl);
  assert.ok(r.events.find((e) => e.type === 'economyFlip'), 'economyFlip event emitted');
});

test('turnCount increments once per end-turn (independent of stock cadence)', () => {
  let s = makeRoom(2);
  const ctx = { rng: makeRng(42) };
  for (let i = 0; i < 5; i++) {
    s.turn = { seat: s.turn.seat, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
    s = step(s, { type: 'endTurn', seat: s.turn.seat }, ctx).state;
  }
  assert.equal(s.turnCount, 5);
});
