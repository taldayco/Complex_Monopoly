import { round4 } from '../../shared/money.js';
import {
  BASE_INF_INT_DECK,
  INF_INT_WILDCARD_POOL,
  STARTING_RESERVE_RATE,
  RESERVE_FLOOR,
  STARTING_INFLATION,
  ECONOMY_HISTORY_CAP
} from '../../shared/reserve/economyCatalog.js';
import { seededRng, shuffleInPlace } from '../../shared/rng/seeded.js';

export function createEconomyState(rngSeed = 0) {
  const econ = {
    reserveRate: STARTING_RESERVE_RATE,
    inflationFactor: STARTING_INFLATION,
    deck: [],
    wildPool: [],
    history: [],
    lastFlip: null,
    round: 0,
    tempEffects: []
  };
  buildInitialDeckSeeded(econ, rngSeed);
  return econ;
}

export function hydrateEconomy(econ, rngSeed = 0) {
  if (!econ || typeof econ !== 'object') return createEconomyState(rngSeed);
  if (typeof econ.reserveRate !== 'number') econ.reserveRate = STARTING_RESERVE_RATE;
  if (typeof econ.inflationFactor !== 'number' || econ.inflationFactor <= 0) {
    econ.inflationFactor = STARTING_INFLATION;
  }
  if (!Array.isArray(econ.deck)) econ.deck = [];
  if (!Array.isArray(econ.wildPool)) econ.wildPool = [];
  if (!Array.isArray(econ.history)) econ.history = [];
  if (!Array.isArray(econ.tempEffects)) econ.tempEffects = [];
  if (typeof econ.round !== 'number') econ.round = 0;
  if (econ.lastFlip === undefined) econ.lastFlip = null;
  if (econ.deck.length === 0 && econ.wildPool.length === 0) {
    buildInitialDeckSeeded(econ, rngSeed);
  }
  return econ;
}

function hasEconomyEffect(econ, kind) {
  return Array.isArray(econ?.tempEffects) && econ.tempEffects.some((e) => e?.kind === kind);
}

export function expireEconomyTempEffects(econ, turnCount, rng) {
  if (!Array.isArray(econ?.tempEffects) || econ.tempEffects.length === 0) return [];
  const expired = [];
  const remaining = [];
  for (const eff of econ.tempEffects) {
    if (typeof eff?.expiresAtTurn === 'number' && turnCount >= eff.expiresAtTurn) {
      expired.push(eff);
    } else {
      remaining.push(eff);
    }
  }
  econ.tempEffects = remaining;
  for (const eff of expired) {
    if (eff.kind === 'inflationFreeze') {
      econ.inflationFactor = STARTING_INFLATION;
      if (typeof rng === 'function') {
        const built = buildDeckFor(rng);
        econ.deck = built.deck;
        econ.wildPool = built.wildPool;
      }
    }
  }
  return expired;
}

function pickRandomWildcards(rng) {
  const n = INF_INT_WILDCARD_POOL.length;
  const a = INF_INT_WILDCARD_POOL[Math.floor(rng() * n)];
  const b = INF_INT_WILDCARD_POOL[Math.floor(rng() * n)];
  return [{ ...a }, { ...b }];
}

function buildDeckFor(rng) {
  const wilds = pickRandomWildcards(rng);
  const cards = [
    ...BASE_INF_INT_DECK.map((c) => ({ inf: c.inf, int: c.int, wild: false })),
    ...wilds.map((c) => ({ inf: c.inf, int: c.int, wild: true }))
  ];
  shuffleInPlace(cards, rng);
  return { deck: cards, wildPool: wilds };
}

function buildInitialDeckSeeded(econ, rngSeed) {
  const built = buildDeckFor(seededRng(rngSeed, 17));
  econ.deck = built.deck;
  econ.wildPool = built.wildPool;
}

function ensureDeck(econ, rng) {
  if (econ.deck.length > 0) return false;
  const built = buildDeckFor(rng);
  econ.deck = built.deck;
  econ.wildPool = built.wildPool;
  return true;
}

function drawTopCard(econ, rng) {
  const reshuffled = ensureDeck(econ, rng);
  if (econ.deck.length === 0) return { card: null, reshuffled };
  return { card: econ.deck.shift(), reshuffled };
}

function pushHistory(econ, entry) {
  econ.history.push(entry);
  if (econ.history.length > ECONOMY_HISTORY_CAP) {
    econ.history.splice(0, econ.history.length - ECONOMY_HISTORY_CAP);
  }
}

export function flipEconomy(econ, rng, now = Date.now()) {
  const { card, reshuffled } = drawTopCard(econ, rng);
  if (!card) {
    return { card: null, intIgnored: false, reshuffled, reserveRate: econ.reserveRate, inflationFactor: econ.inflationFactor };
  }

  const interestFrozen = hasEconomyEffect(econ, 'interestFreeze');
  const inflationFrozen = hasEconomyEffect(econ, 'inflationFreeze');

  let intIgnored = false;
  if (interestFrozen) {
    intIgnored = true;
  } else {
    const proposedRate = econ.reserveRate + card.int;
    if (proposedRate < RESERVE_FLOOR) {
      intIgnored = true;
      econ.reserveRate = RESERVE_FLOOR;
    } else {
      econ.reserveRate = round4(proposedRate);
    }
  }

  if (!inflationFrozen) {
    econ.inflationFactor = Math.max(0.01, round4(econ.inflationFactor + card.inf));
  }

  econ.round += 1;

  const entry = {
    inf: card.inf,
    int: card.int,
    wild: !!card.wild,
    intIgnored,
    reserveRate: econ.reserveRate,
    inflationFactor: econ.inflationFactor
  };
  pushHistory(econ, entry);

  econ.lastFlip = {
    at: now,
    card: { inf: card.inf, int: card.int, wild: !!card.wild },
    intIgnored,
    reserveRate: econ.reserveRate,
    inflationFactor: econ.inflationFactor,
    reshuffled
  };
  return { card, intIgnored, reshuffled, reserveRate: econ.reserveRate, inflationFactor: econ.inflationFactor };
}
