import {
  CREDIT_TIERS,
  TIER_BY_NAME,
  TIER_MULTIPLIER_FOR_LINE,
  effectiveTier,
  getTierByScore,
  sumOpenBankBalances,
  sumActiveLoanBalances,
  MISSED_PAYMENT_CREDIT_PENALTY
} from './loanCatalog.js';

const TIER_RANK = Object.fromEntries(CREDIT_TIERS.map((t, i) => [t.name, i]));

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
      hysaBonus: 0.01,
      railRebate: 0.5,
      utilityRebate: 0.5,
      baseRentRebate: 1.0
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
      goBonus: 50,
      goLandingBonus: 100,
      otherLandingBonus: 10
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
      rentRebate: 0.15,
      developmentRebate: 0.15
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
      hysaBonus: 0.02,
      maxLineBonus: 0.4,
      blueGreenRentRebate: 0.5
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
      hysaBonus: 0.0125,
      ptrDiscount: 0.02
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
      missedPaymentPenalty: 5,
      bankPaysFirstInstallment: true
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

export const BANK_NAME_TO_CODE = {
  'MM Credit Union': 'mmcu',
  'Boardwalk National Bank': 'boardwalk'
};

export const CREDIT_LINE_INCREASE_PENALTY = 25;
export const CARD_PAYMENT_CYCLE_TURNS = 4;

export const UTILIZATION_BUCKETS = [
  { min: 0,    max: 0.30, delta: 5 },
  { min: 0.30, max: 0.50, delta: 0 },
  { min: 0.50, max: 0.75, delta: -5 },
  { min: 0.75, max: Infinity, delta: -10 }
];

export function utilizationDelta(utilizationPct) {
  if (typeof utilizationPct !== 'number' || !Number.isFinite(utilizationPct)) return 0;
  for (const b of UTILIZATION_BUCKETS) {
    if (utilizationPct >= b.min && utilizationPct < b.max) return b.delta;
  }
  return 0;
}

export function getCard(cardId) {
  return CARD_CATALOG[cardId] ?? null;
}

export function getCardBankCode(cardId) {
  const card = CARD_CATALOG[cardId];
  if (!card) return null;
  return BANK_NAME_TO_CODE[card.bank] ?? null;
}

export function meetsTierRequirement(seat, requiredTierName) {
  const seatTier = effectiveTier(seat);
  return TIER_RANK[seatTier.name] >= TIER_RANK[requiredTierName];
}

export function* activeCards(seat) {
  if (!Array.isArray(seat?.creditCards)) return;
  for (const c of seat.creditCards) {
    if (c.status !== 'active') continue;
    const cat = CARD_CATALOG[c.cardId];
    if (cat) yield cat;
  }
}

function sumActiveCardLineBonus(seat) {
  let mult = 0;
  for (const card of activeCards(seat)) {
    if (typeof card.benefits?.maxLineBonus === 'number') mult += card.benefits.maxLineBonus;
  }
  return mult;
}

export function calcCreditLine(seat, cardId) {
  const card = CARD_CATALOG[cardId];
  if (!card) return 0;
  const tier = effectiveTier(seat);
  const mult = TIER_MULTIPLIER_FOR_LINE[tier.name] ?? 0;
  const cash = typeof seat?.cash === 'number' ? seat.cash : 0;
  const base = Math.max(0, cash + sumOpenBankBalances(seat) - sumActiveLoanBalances(seat));
  let raw = base * mult;
  const bonus = sumActiveCardLineBonus(seat);
  if (bonus > 0) raw *= 1 + bonus;
  const dynamic = Math.round(raw / 10) * 10;
  return Math.max(dynamic, card.minLine ?? 0);
}

export function getCardLineBonusFor(seat) {
  return sumActiveCardLineBonus(seat);
}

export function getMissedPaymentPenalty(seat) {
  let best = MISSED_PAYMENT_CREDIT_PENALTY;
  for (const card of activeCards(seat)) {
    const v = card.benefits?.missedPaymentPenalty;
    if (typeof v === 'number' && v < best) best = v;
  }
  return best;
}

export function getMissedPaymentPenaltyForCard(cardId) {
  const card = CARD_CATALOG[cardId];
  if (!card) return MISSED_PAYMENT_CREDIT_PENALTY;
  const v = card.benefits?.missedPaymentPenalty;
  return typeof v === 'number' ? v : MISSED_PAYMENT_CREDIT_PENALTY;
}

export function getPtrDiscountFor(seat) {
  let total = 0;
  for (const card of activeCards(seat)) {
    if (typeof card.benefits?.ptrDiscount === 'number') {
      total += card.benefits.ptrDiscount;
    }
  }
  return total;
}

export function getHysaRateFor(seat, baseRate) {
  const base = baseRate ?? 0;
  let bonus = 0;
  for (const card of activeCards(seat)) {
    if (typeof card.benefits?.hysaBonus === 'number') {
      bonus += card.benefits.hysaBonus;
    }
  }
  return Math.max(0, Math.round((base + bonus) * 10000) / 10000);
}

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

export function getBaseRentRebateFor(seat) {
  return sumBenefit(seat, 'baseRentRebate');
}

export function getGenericRentRebateFor(seat) {
  return sumBenefit(seat, 'rentRebate');
}

export function getBlueGreenRentRebateFor(seat) {
  return sumBenefit(seat, 'blueGreenRentRebate');
}

export function getGoBonusFor(seat) {
  return sumBenefit(seat, 'goBonus');
}

export function getGoLandingBonusFor(seat) {
  return sumBenefit(seat, 'goLandingBonus');
}

export function getOtherLandingBonusFor(seat) {
  return sumBenefit(seat, 'otherLandingBonus');
}

export function getDevelopmentRebateFor(seat) {
  return Math.min(1, sumBenefit(seat, 'developmentRebate'));
}

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
