// Loan pricing & credit-tier reference data, ported from the reserve project.
// Pure constants + helpers — usable on client and server.

export const CREDIT_TIERS = [
  { name: 'Poor', min: 0 },
  { name: 'Fair', min: 580 },
  { name: 'Good', min: 670 },
  { name: 'Very Good', min: 740 },
  { name: 'Excellent', min: 800 }
];

export const TIER_BY_NAME = Object.fromEntries(CREDIT_TIERS.map((t) => [t.name, t]));

// Maximum new-loan principal a seat is eligible for, by tier.
export const MAX_LINE_BY_TIER = {
  Poor: 0,
  Fair: 100,
  Good: 250,
  'Very Good': 500,
  Excellent: 1000
};

// Available repayment term lengths (turns).
export const LOAN_TERMS = [3, 5, 8];

// Base per-turn rate (decimal) by tier and term. Longer terms get a slightly
// lower per-turn rate to compensate for the larger total interest paid.
export const BASE_PTR_BY_TIER_TERM = {
  Fair:        { 3: 0.08,  5: 0.07,   8: 0.06 },
  Good:        { 3: 0.06,  5: 0.05,   8: 0.04 },
  'Very Good': { 3: 0.05,  5: 0.04,   8: 0.03 },
  Excellent:   { 3: 0.03,  5: 0.025,  8: 0.02 }
};

// Each pip of the dice roll adds this to the PTR. Roll 1 = +0%, roll 6 = +2%.
// Lower roll = better rate; the dice add controlled randomness on top of tier.
export const LOAN_DICE_MODIFIER_PER_PIP = 0.004;

// Credit-score penalty for a missed installment.
export const MISSED_PAYMENT_CREDIT_PENALTY = 10;

// Minimum credit score (floor for penalties).
export const MIN_CREDIT_SCORE = 300;

export function getTierByScore(score) {
  if (typeof score !== 'number') return CREDIT_TIERS[0];
  let tier = CREDIT_TIERS[0];
  for (const t of CREDIT_TIERS) {
    if (score >= t.min) tier = t;
  }
  return tier;
}

export function getMaxLine(score) {
  return MAX_LINE_BY_TIER[getTierByScore(score).name] ?? 0;
}

// Compute the three term options for a given seat score, principal, and dice
// roll. Returns null if the seat is below the eligibility floor (Poor tier).
//   { tier, maxLine, options: [{ term, ptr, totalDebt, installment }, …] }
export function calcLoanOptions(score, principal, roll) {
  const tier = getTierByScore(score);
  if (tier.name === 'Poor') return null;
  const maxLine = MAX_LINE_BY_TIER[tier.name] ?? 0;
  const r = Math.max(1, Math.min(6, Math.floor(roll)));
  const dieMod = (r - 1) * LOAN_DICE_MODIFIER_PER_PIP;
  const options = LOAN_TERMS.map((term) => {
    const base = BASE_PTR_BY_TIER_TERM[tier.name][term];
    const ptr = Math.round((base + dieMod) * 10000) / 10000;
    const totalDebt = Math.round(principal * (1 + ptr * term) * 100) / 100;
    const installment = Math.round((totalDebt / term) * 100) / 100;
    return { term, ptr, totalDebt, installment };
  });
  return { tier, maxLine, options };
}
