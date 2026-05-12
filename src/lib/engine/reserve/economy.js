import { round4 } from '../../shared/money.js';
import {
  BASE_INFLATION_DECK,
  INFLATION_WILDCARD_POOL,
  STARTING_RESERVE_RATE,
  RESERVE_FLOOR,
  STARTING_INFLATION,
  ECONOMY_HISTORY_CAP,
  TARGET_INFLATION_PER_TURN,
  POLICY_REACTION,
  POLICY_LAG_TURNS
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

export function expireEconomyTempEffects(econ, turnCount) {
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
  return expired;
}

function pickRandomWildcards(rng) {
  const n = INFLATION_WILDCARD_POOL.length;
  const a = INFLATION_WILDCARD_POOL[Math.floor(rng() * n)];
  const b = INFLATION_WILDCARD_POOL[Math.floor(rng() * n)];
  return [{ ...a }, { ...b }];
}

function buildDeckFor(rng) {
  const wilds = pickRandomWildcards(rng);
  const cards = [
    ...BASE_INFLATION_DECK.map((c) => ({ inf: c.inf, wild: false })),
    ...wilds.map((c) => ({ inf: c.inf, wild: true }))
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
    return {
      card: null,
      intIgnored: false,
      policyDelta: 0,
      reshuffled,
      reserveRate: econ.reserveRate,
      inflationFactor: econ.inflationFactor
    };
  }

  const interestFrozen = hasEconomyEffect(econ, 'interestFreeze');
  const inflationFrozen = hasEconomyEffect(econ, 'inflationFreeze');

  if (!inflationFrozen) {
    econ.inflationFactor = Math.max(0.01, round4(econ.inflationFactor + card.inf));
  }

  const lagIdx = econ.history.length - POLICY_LAG_TURNS;
  const laggedInf = lagIdx >= 0 ? econ.history[lagIdx].inf : card.inf;
  const policyDelta = round4((laggedInf - TARGET_INFLATION_PER_TURN) * POLICY_REACTION);

  let intIgnored = false;
  if (interestFrozen) {
    intIgnored = true;
  } else {
    const proposed = econ.reserveRate + policyDelta;
    if (proposed < RESERVE_FLOOR) {
      intIgnored = true;
      econ.reserveRate = RESERVE_FLOOR;
    } else {
      econ.reserveRate = round4(proposed);
    }
  }

  econ.round += 1;

  const entry = {
    inf: card.inf,
    policyDelta,
    wild: !!card.wild,
    intIgnored,
    reserveRate: econ.reserveRate,
    inflationFactor: econ.inflationFactor
  };
  pushHistory(econ, entry);

  econ.lastFlip = {
    at: now,
    card: { inf: card.inf, wild: !!card.wild },
    policyDelta,
    intIgnored,
    reserveRate: econ.reserveRate,
    inflationFactor: econ.inflationFactor,
    reshuffled
  };
  return {
    card,
    intIgnored,
    policyDelta,
    reshuffled,
    reserveRate: econ.reserveRate,
    inflationFactor: econ.inflationFactor
  };
}
