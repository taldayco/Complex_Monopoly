// Credit-card catalog ported from the reserve project. Cards are tier-gated;
// each one charges a signing fee, a per-turn rotating fee, and a cancel fee.
// Active benefits modify other systems (loans, HYSA, rent, GO collection,
// development, first-installment coverage) — see the `getXxxFor(seat)`
// helpers below for the read sites used by the engine.

import {
  CREDIT_TIERS,
  TIER_BY_NAME,
  MAX_LINE_BY_TIER,
  getTierByScore,
  MISSED_PAYMENT_CREDIT_PENALTY
} from './loanCatalog.js';

const TIER_RANK = Object.fromEntries(CREDIT_TIERS.map((t, i) => [t.name, i]));

// Each card lists the bank that issues it, the up-front signing fee/bonus,
// a fee charged when the holder passes GO, a cancellation fee, the credit
// tier required to apply, the minimum credit line provided, the interest
// rate charged on outstanding card balance every 4 turn rotations, and the
// minimum per-cycle payment. `rotatingFee` is the legacy flat per-turn fee
// (kept at 0 — the new interest-on-balance model replaces it but is not yet
// wired on the engine side).
export const CARD_CATALOG = {
  readingRail: {
    id: 'readingRail',
    name: 'Reading Rail Reserve',
    bank: 'MM Credit Union',
    requiredTier: 'Fair',
    signingFee: 0,
    signupBonus: 200,
    goFee: 0,
    cancelFee: 400,
    rotatingFee: 0,
    minLine: 200,
    interestRate: 0.30,
    minPayment: 25,
    benefits: {
      hysaBonus: 0.01,            // +1% HYSA — WIRED
      railRebate: 0.5,            // bank pays 50% of railroad payments — WIRED
      utilityRebate: 0.5,         // bank pays 50% of utility payments — WIRED
      baseRentRebate: 1.0         // bank pays 100% of base rent (no doubles, no developments) — WIRED
    },
    blurb: '+1% HYSA · bank covers 50% rail/utility · 100% base rent'
  },
  goRewards: {
    id: 'goRewards',
    name: 'GO Rewards',
    bank: 'MM Credit Union',
    requiredTier: 'Good',
    signingFee: 0,
    signupBonus: 50,
    goFee: 0,
    cancelFee: 200,
    rotatingFee: 0,
    minLine: 400,
    interestRate: 0.28,
    minPayment: 25,
    benefits: {
      goBonus: 50,                 // +$50 when passing GO without landing — WIRED
      goLandingBonus: 100,         // +$100 when landing on GO — WIRED
      otherLandingBonus: 10        // +$10 from bank when player lands on your property — WIRED
    },
    blurb: '+$50 pass GO · +$100 land on GO · +$10 from bank per landing'
  },
  portfolioGold: {
    id: 'portfolioGold',
    name: 'Portfolio Gold',
    bank: 'MM Credit Union',
    requiredTier: 'Good',
    signingFee: 0,
    signupBonus: 0,
    goFee: 30,
    cancelFee: 100,
    rotatingFee: 0,
    minLine: 500,
    interestRate: 0.26,
    minPayment: 25,
    benefits: {
      rentRebate: 0.15,            // bank pays 15% of all rent — WIRED
      developmentRebate: 0.15      // bank pays 15% of house/hotel purchases — WIRED
    },
    blurb: 'Bank covers 15% of rent/bills · 15% of development costs'
  },
  boardwalkPreferred: {
    id: 'boardwalkPreferred',
    name: 'Boardwalk Preferred',
    bank: 'Boardwalk National Bank',
    requiredTier: 'Very Good',
    signingFee: 100,
    signupBonus: 0,
    goFee: 100,
    cancelFee: 50,
    rotatingFee: 0,
    minLine: 1000,
    interestRate: 0.24,
    minPayment: 50,
    benefits: {
      hysaBonus: 0.02,             // +2% HYSA — WIRED
      maxLineBonus: 0.4,           // +40% max loan line — WIRED
      blueGreenRentRebate: 0.5     // bank pays 50% of rent on darkblue/green — WIRED
    },
    blurb: '+2% HYSA · +40% max loan · bank covers 50% blue/green rent'
  },
  primeAdvantage: {
    id: 'primeAdvantage',
    name: 'Prime Advantage Gold',
    bank: 'Boardwalk National Bank',
    requiredTier: 'Very Good',
    signingFee: 100,
    signupBonus: 0,
    goFee: 75,
    cancelFee: 200,
    rotatingFee: 0,
    minLine: 800,
    interestRate: 0.22,
    minPayment: 50,
    benefits: {
      hysaBonus: 0.0125,           // +1.25% HYSA — WIRED
      ptrDiscount: 0.02            // -2% PTR on new loans — WIRED
    },
    blurb: '+1.25% HYSA · -2% per-turn rate on new loans'
  },
  vaultPlatinum: {
    id: 'vaultPlatinum',
    name: 'Vault Platinum',
    bank: 'Boardwalk National Bank',
    requiredTier: 'Excellent',
    signingFee: 400,
    signupBonus: 0,
    goFee: 200,
    cancelFee: 100,
    rotatingFee: 0,
    minLine: 1200,
    interestRate: 0.20,
    minPayment: 100,
    benefits: {
      missedPaymentPenalty: 5,               // -5 instead of -10 — WIRED
      bankPaysFirstInstallment: true         // bank covers max of first installment while keeping recovery ≥ principal+$100 — WIRED
    },
    blurb: 'Bank covers first installment · softer skip-penalty (-5)'
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

// ---------- RENT REBATES ----------
// Each helper sums applicable rebate fractions across active cards. The reducer
// composes them additively (capped at 1) and the bank covers the rebated
// portion — the property owner still receives full rent.

function sumBenefit(seat, key) {
  let total = 0;
  for (const card of activeCards(seat)) {
    const v = card.benefits?.[key];
    if (typeof v === 'number') total += v;
  }
  return total;
}

export function getRailRebateFor(seat) {
  return sumBenefit(seat, 'railRebate');
}

export function getUtilityRebateFor(seat) {
  return sumBenefit(seat, 'utilityRebate');
}

// readingRail's baseRentRebate only applies when rent IS unimproved single
// rent — i.e. no houses AND owner does not hold the full color group. The
// caller must check those preconditions; this helper just sums the fractions.
export function getBaseRentRebateFor(seat) {
  return sumBenefit(seat, 'baseRentRebate');
}

// Generic "all rent and bills" rebate (portfolioGold). Stacks additively with
// other rent rebates.
export function getGenericRentRebateFor(seat) {
  return sumBenefit(seat, 'rentRebate');
}

// boardwalkPreferred's blueGreenRentRebate: applies on properties in the
// `darkblue` or `green` color groups only.
export function getBlueGreenRentRebateFor(seat) {
  return sumBenefit(seat, 'blueGreenRentRebate');
}

// ---------- GO BONUSES ----------

export function getGoBonusFor(seat) {
  return sumBenefit(seat, 'goBonus');
}

export function getGoLandingBonusFor(seat) {
  return sumBenefit(seat, 'goLandingBonus');
}

// Bank pays this to the owner each time a player lands on their property.
// Independent of whether rent is owed (mortgaged owners still get it).
export function getOtherLandingBonusFor(seat) {
  return sumBenefit(seat, 'otherLandingBonus');
}

// ---------- DEVELOPMENT ----------
// Fraction of house/hotel cost that the bank covers. Stacks additively across
// cards (currently only portfolioGold provides one), capped at 1.
export function getDevelopmentRebateFor(seat) {
  return Math.min(1, sumBenefit(seat, 'developmentRebate'));
}

// ---------- LOAN: FIRST INSTALLMENT ----------
// vaultPlatinum: when paying the first installment of a new loan, the bank
// covers up to the full installment amount, but the bank's net recovery
// (totalDebt minus what it covers) must remain at least principal + $100.
// Returns the dollar amount the bank covers; 0 if no eligible card is active.
const FIRST_INSTALLMENT_RECOVERY_FLOOR = 100;
export function getFirstInstallmentCoverageFor(seat, loan) {
  if (!loan || (loan.paymentsMade ?? 0) !== 0) return 0;
  let eligible = false;
  for (const card of activeCards(seat)) {
    if (card.benefits?.bankPaysFirstInstallment === true) {
      eligible = true;
      break;
    }
  }
  if (!eligible) return 0;
  const cap = (loan.totalDebt ?? 0) - (loan.principal ?? 0) - FIRST_INSTALLMENT_RECOVERY_FLOOR;
  if (cap <= 0) return 0;
  const due = Math.min(loan.installment ?? 0, loan.balance ?? 0);
  return Math.round(Math.min(due, cap) * 100) / 100;
}
