export const CREDIT_TIERS = [
  { name: 'Very Poor', min: 300, max: 349 },
  { name: 'Poor', min: 350, max: 579 },
  { name: 'Fair', min: 580, max: 669 },
  { name: 'Good', min: 670, max: 739 },
  { name: 'Very Good', min: 740, max: 799 },
  { name: 'Excellent', min: 800, max: 850 }
];

export const TIER_BY_NAME = Object.fromEntries(CREDIT_TIERS.map((t) => [t.name, t]));

export const TIER_MULTIPLIER_FOR_LINE = {
  'Very Poor': 0,
  Poor: 0,
  Fair: 1.5,
  Good: 1.75,
  'Very Good': 2.0,
  Excellent: 2.25
};

export const LOAN_TERMS = [3, 5, 8];

export const PTR_BY_TIER_AND_DICE = {
  Excellent:   [0.03, 0.035, 0.04,  0.045, 0.05,  0.055],
  'Very Good': [0.06, 0.065, 0.07,  0.075, 0.08,  0.085],
  Good:        [0.09, 0.095, 0.10,  0.105, 0.11,  0.115],
  Fair:        [0.10, 0.11,  0.12,  0.13,  0.14,  0.15]
};

export const TERM_PREMIUM = { 3: 0, 5: 0.01, 8: 0.02 };

export const STANDARD_LOAN_MIN_PRINCIPAL = 100;
export const STANDARD_LOANS_PER_TURN = 5;
export const STANDARD_LOAN_APPLY_CREDIT_PENALTY = 50;
export const STANDARD_LOAN_ANTI_HACK_BONUS = 5;

export const MISSED_PAYMENT_CREDIT_PENALTY = 10;

export const MIN_CREDIT_SCORE = 300;
export const MAX_CREDIT_SCORE = 850;
export const BANKRUPTCY_FLOOR = 350;

export function clampCreditScore(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return MIN_CREDIT_SCORE;
  if (score < MIN_CREDIT_SCORE) return MIN_CREDIT_SCORE;
  if (score > MAX_CREDIT_SCORE) return MAX_CREDIT_SCORE;
  return score;
}

export function getTierByScore(score) {
  if (typeof score !== 'number') return CREDIT_TIERS[0];
  let tier = CREDIT_TIERS[0];
  for (const t of CREDIT_TIERS) {
    if (score >= t.min) tier = t;
  }
  return tier;
}

export function sumOpenBankBalances(seat) {
  const accts = seat?.bankAccounts;
  if (!accts) return 0;
  let sum = 0;
  for (const key of Object.keys(accts)) {
    const a = accts[key];
    if (a?.open && typeof a.balance === 'number') sum += a.balance;
  }
  return Math.round(sum * 100) / 100;
}

export function sumActiveLoanBalances(seat) {
  let sum = 0;
  for (const l of seat?.loans ?? []) {
    if (l?.status === 'active' && typeof l.balance === 'number' && l.balance > 0) sum += l.balance;
  }
  for (const l of seat?.mortgageLoans ?? []) {
    if (l?.status === 'active' && typeof l.balance === 'number' && l.balance > 0) sum += l.balance;
  }
  return Math.round(sum * 100) / 100;
}

export function calcMaxStandardLoan(seat, opts = {}) {
  const score = seat?.creditScore ?? 0;
  const tier = getTierByScore(score);
  const mult = TIER_MULTIPLIER_FOR_LINE[tier.name] ?? 0;
  if (mult === 0) return 0;
  const cash = typeof seat?.cash === 'number' ? seat.cash : 0;
  const base = Math.max(0, cash + sumOpenBankBalances(seat) - sumActiveLoanBalances(seat));
  let raw = base * mult;
  if (typeof opts.cardLineBonus === 'number' && opts.cardLineBonus > 0) {
    raw *= 1 + opts.cardLineBonus;
  }
  if (typeof opts.tempBoost === 'number' && opts.tempBoost > 0) {
    raw *= 1 + opts.tempBoost;
  }
  return Math.round(raw / 50) * 50;
}

export function calcLoanOptions(score, principal, roll, opts = {}) {
  const tier = getTierByScore(score);
  if (tier.name === 'Poor' || tier.name === 'Very Poor') return null;
  const r = Math.max(1, Math.min(6, Math.floor(roll)));
  const baseRate = PTR_BY_TIER_AND_DICE[tier.name][r - 1];
  const reserveRate = typeof opts.reserveRate === 'number' ? opts.reserveRate : 0;
  const boardwalkDiscount = typeof opts.boardwalkDiscount === 'number' ? opts.boardwalkDiscount : 0;
  const tempRateDiscount = typeof opts.tempRateDiscount === 'number' ? opts.tempRateDiscount : 0;
  const options = LOAN_TERMS.map((term) => {
    const raw = baseRate + TERM_PREMIUM[term] + reserveRate - boardwalkDiscount - tempRateDiscount;
    const ptr = Math.max(0, Math.round(raw * 10000) / 10000);
    const totalDebt = Math.round(principal * (1 + ptr * term) * 100) / 100;
    const installment = Math.round((totalDebt / term) * 100) / 100;
    return { term, ptr, totalDebt, installment };
  });
  return { tier, options };
}
