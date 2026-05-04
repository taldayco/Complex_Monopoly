// Credit-card catalog ported from the reserve project. Cards are tier-gated;
// each one charges a signing fee, a per-turn rotating fee, and a cancel fee.
// Active benefits modify other systems (loans, HYSA, rent) — see the
// `getXxxFor(seat)` helpers below for the ones currently wired.
//
// Some benefits in the catalog are placeholders: they are listed so the UI
// can render them, but the engine does not yet consume them. Each one carries
// a `wired: true|false` marker on the benefit so future phases know what
// remains.

import {
  CREDIT_TIERS,
  TIER_BY_NAME,
  MAX_LINE_BY_TIER,
  getTierByScore,
  MISSED_PAYMENT_CREDIT_PENALTY
} from './loanCatalog.js';

const TIER_RANK = Object.fromEntries(CREDIT_TIERS.map((t, i) => [t.name, i]));

export const CARD_CATALOG = {
  readingRail: {
    id: 'readingRail',
    name: 'Reading Rail Reserve',
    requiredTier: 'Fair',
    signingFee: 25,
    rotatingFee: 5,
    cancelFee: 10,
    signupBonus: 0,
    benefits: {
      hysaBonus: 0.01,            // +1% HYSA — wired in Phase 7
      railUtilityRentDiscount: 0.5 // 50% off rail/utility rent — wired later
    },
    blurb: '+1% HYSA · 50% off rail/utility rent'
  },
  goRewards: {
    id: 'goRewards',
    name: 'GO Rewards',
    requiredTier: 'Fair',
    signingFee: 30,
    rotatingFee: 5,
    cancelFee: 10,
    signupBonus: 0,
    benefits: {
      goBonus: 50,                 // +$50 per GO pass — wired later
      otherLandingBonus: 10        // +$10 per other player landing on yours — wired later
    },
    blurb: '+$50 per GO pass · +$10 per other player landing on your property'
  },
  portfolioGold: {
    id: 'portfolioGold',
    name: 'Portfolio Gold',
    requiredTier: 'Good',
    signingFee: 50,
    rotatingFee: 10,
    cancelFee: 25,
    signupBonus: 0,
    benefits: {
      rentRebate: 0.15             // bank pays 15% of rent — wired later
    },
    blurb: 'Bank reimburses 15% of all rent paid'
  },
  vaultPlatinum: {
    id: 'vaultPlatinum',
    name: 'Vault Platinum',
    requiredTier: 'Very Good',
    signingFee: 75,
    rotatingFee: 15,
    cancelFee: 30,
    signupBonus: 50,
    benefits: {
      maxLineBonus: 0.25,                    // +25% max loan line — WIRED
      missedPaymentPenalty: 5,               // -5 instead of -10 — WIRED
      bankPaysFirstInstallment: true         // wired later
    },
    blurb: '+25% max loan · softer skip-penalty · bank covers first installment'
  },
  boardwalkPreferred: {
    id: 'boardwalkPreferred',
    name: 'Boardwalk Preferred',
    requiredTier: 'Excellent',
    signingFee: 100,
    rotatingFee: 20,
    cancelFee: 50,
    signupBonus: 0,
    benefits: {
      hysaBonus: 0.02,             // +2% HYSA — wired in Phase 7
      maxLineBonus: 0.4,           // +40% max loan line — WIRED
      blueRentDiscount: 0.5        // 50% off blue rent — wired later
    },
    blurb: '+2% HYSA · +40% max loan · 50% off blue rent'
  },
  primeAdvantage: {
    id: 'primeAdvantage',
    name: 'Prime Advantage Gold',
    requiredTier: 'Very Good',
    signingFee: 50,
    rotatingFee: 10,
    cancelFee: 20,
    signupBonus: 0,
    benefits: {
      ptrDiscount: 0.01            // -1% PTR on new loans — WIRED
    },
    blurb: '-1% per-turn rate on new loans'
  }
};

export const CARD_ORDER = [
  'readingRail',
  'goRewards',
  'portfolioGold',
  'primeAdvantage',
  'vaultPlatinum',
  'boardwalkPreferred'
];

export function getCard(cardId) {
  return CARD_CATALOG[cardId] ?? null;
}

export function meetsTierRequirement(seat, requiredTierName) {
  const score = seat?.creditScore ?? 0;
  const seatTier = getTierByScore(score);
  return TIER_RANK[seatTier.name] >= TIER_RANK[requiredTierName];
}

// Iterate active cards on a seat, yielding the catalog entry for each.
export function* activeCards(seat) {
  if (!Array.isArray(seat?.creditCards)) return;
  for (const c of seat.creditCards) {
    if (c.status !== 'active') continue;
    const cat = CARD_CATALOG[c.cardId];
    if (cat) yield cat;
  }
}

// ---------- WIRED MODIFIERS ----------

// Maximum loan line for a seat, factoring in card bonuses (multiplicative).
export function getMaxLineFor(seat) {
  const score = seat?.creditScore ?? 0;
  const baseMax = MAX_LINE_BY_TIER[getTierByScore(score).name] ?? 0;
  let mult = 1;
  for (const card of activeCards(seat)) {
    if (typeof card.benefits?.maxLineBonus === 'number') {
      mult *= 1 + card.benefits.maxLineBonus;
    }
  }
  return Math.round(baseMax * mult);
}

// Credit-score penalty for a missed installment. Cards that lower the penalty
// (Vault Platinum: 5) override the default. The lowest (best) override wins.
export function getMissedPaymentPenalty(seat) {
  let best = MISSED_PAYMENT_CREDIT_PENALTY;
  for (const card of activeCards(seat)) {
    const v = card.benefits?.missedPaymentPenalty;
    if (typeof v === 'number' && v < best) best = v;
  }
  return best;
}

// Total PTR discount (decimal) from active cards. Subtracted from the offer
// PTR at request time, with a floor at 0.
export function getPtrDiscountFor(seat) {
  let total = 0;
  for (const card of activeCards(seat)) {
    if (typeof card.benefits?.ptrDiscount === 'number') {
      total += card.benefits.ptrDiscount;
    }
  }
  return total;
}

// Effective HYSA rate: seat's base rate (typically the catalog default) plus
// every active card's hysaBonus, summed.
export function getHysaRateFor(seat, baseRate) {
  const base = typeof seat?.hysaRate === 'number' ? seat.hysaRate : (baseRate ?? 0);
  let bonus = 0;
  for (const card of activeCards(seat)) {
    if (typeof card.benefits?.hysaBonus === 'number') {
      bonus += card.benefits.hysaBonus;
    }
  }
  return Math.max(0, Math.round((base + bonus) * 10000) / 10000);
}
