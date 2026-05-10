import { BOARD, isOwnable } from '../shared/board.js';
import { COLOR_GROUPS } from '../shared/constants.js';
import { inflatedPrice } from '../shared/economy/inflation.js';
import {
  clampCreditScore,
  getTierByScore,
  STANDARD_LOAN_ANTI_HACK_BONUS
} from '../shared/reserve/loanCatalog.js';

export const MORTGAGE_TIER_RATES = {
  Excellent:   { 5: 0.05, 10: 0.08 },
  'Very Good': { 5: 0.08, 10: 0.10 },
  Good:        { 5: 0.10, 10: 0.12 },
  Fair:        { 5: 0.12, 10: 0.15 }
};

export const MORTGAGE_TERMS = [5, 10];
export const MORTGAGE_MAX_DOWN_PAYMENT = 0.75;
export const MORTGAGE_PAYMENT_BONUS = 1;
export const MORTGAGE_MISSED_PENALTY = 1;

let MORTGAGE_LOAN_ID_COUNTER = 0;
function genMortgageLoanId(seat) {
  MORTGAGE_LOAN_ID_COUNTER += 1;
  return `M-${seat.seat}-${(seat.mortgageLoans?.length ?? 0)}-${MORTGAGE_LOAN_ID_COUNTER}`;
}

export function downPaymentDiscount(pct) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return 0;
  if (pct < 0) return 0;
  if (pct >= 0.5) return 0.02;
  if (pct >= 0.25) return 0.01;
  return 0;
}

export function isValidDownPayment(pct) {
  return typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 && pct <= MORTGAGE_MAX_DOWN_PAYMENT;
}

function findActiveMortgageLoan(seat, loanId) {
  return seat.mortgageLoans?.find((l) => l.id === loanId && l.status === 'active');
}

function refreshMortgageTurnResponded(seat) {
  const anyStillDue = (seat.mortgageLoans ?? []).some(
    (l) => l.status === 'active' && l.dueThisTurn
  );
  seat.mortgageTurnResponded = !anyStillDue;
}

export function calcMortgageOffer(seat, propertyIndex, term, downPaymentPct, state, opts = {}) {
  if (!MORTGAGE_TERMS.includes(term)) return { error: 'BAD_TERM' };
  if (!isValidDownPayment(downPaymentPct)) return { error: 'BAD_DOWN_PAYMENT' };
  const tier = getTierByScore(seat?.creditScore ?? 0);
  if (!MORTGAGE_TIER_RATES[tier.name]) return { error: 'NOT_ELIGIBLE' };
  const space = BOARD[propertyIndex];
  if (!space || !isOwnable(space)) return { error: 'NOT_OWNABLE' };
  const prop = state.properties?.[propertyIndex];
  if (!prop || prop.ownerSeat !== seat.seat) return { error: 'NOT_OWNER' };
  if (prop.mortgaged) return { error: 'ALREADY_MORTGAGED' };
  if (prop.houses > 0) return { error: 'HAS_HOUSES' };
  if (space.type === 'property') {
    for (const i of COLOR_GROUPS[space.colorGroup] ?? []) {
      if (state.properties[i].houses > 0) return { error: 'GROUP_HAS_HOUSES' };
    }
  }
  const baseRate = MORTGAGE_TIER_RATES[tier.name][term];
  const reserveRate = typeof opts.reserveRate === 'number' ? opts.reserveRate : 0;
  const dpDiscount = downPaymentDiscount(downPaymentPct);
  const ptr = Math.max(0, Math.round((baseRate + reserveRate - dpDiscount) * 10000) / 10000);
  const downPaymentAmount = Math.round(space.mortgageValue * downPaymentPct * 100) / 100;
  if ((seat?.cash ?? 0) < downPaymentAmount) return { error: 'INSUFFICIENT_FUNDS_FOR_DOWN_PAYMENT' };
  const principal = Math.round(space.mortgageValue * (1 - downPaymentPct) * 100) / 100;
  const totalDebt = Math.round(principal * (1 + ptr * term) * 100) / 100;
  const installment = Math.round((totalDebt / term) * 100) / 100;
  return {
    ok: true,
    tier: tier.name,
    propertyIndex,
    term,
    downPaymentPct,
    downPaymentAmount,
    ptr,
    principal,
    totalDebt,
    installment,
    reserveRateAtIssue: reserveRate
  };
}

export function requestMortgageLoan(state, seatIndex, propertyIndex, term, downPaymentPct, opts = {}, now = Date.now()) {
  const seat = state.seats[seatIndex];
  if (!seat) return { error: 'NO_SEAT' };
  if (seat.bankrupt) return { error: 'BANKRUPT' };
  const offer = calcMortgageOffer(seat, propertyIndex, term, downPaymentPct, state, opts);
  if (!offer.ok) return { error: offer.error };
  if (!Array.isArray(seat.mortgageLoans)) seat.mortgageLoans = [];
  const loan = {
    id: genMortgageLoanId(seat),
    propertyIndex,
    term,
    downPaymentPct,
    downPaymentAmount: offer.downPaymentAmount,
    ptr: offer.ptr,
    ptrAtIssue: offer.ptr,
    reserveRateAtIssue: offer.reserveRateAtIssue,
    principal: offer.principal,
    totalDebt: offer.totalDebt,
    installment: offer.installment,
    paymentsMade: 0,
    balance: offer.totalDebt,
    takenAt: now,
    dueThisTurn: false,
    status: 'active',
    creditCreditedThisTurn: false
  };
  seat.mortgageLoans.push(loan);
  seat.cash = Math.round((seat.cash + offer.principal - offer.downPaymentAmount) * 100) / 100;
  state.properties[propertyIndex].mortgaged = true;
  return { ok: true, loan };
}

export function payMortgageInstallment(state, seatIndex, loanId) {
  const seat = state.seats[seatIndex];
  if (!seat) return { error: 'NO_SEAT' };
  const loan = findActiveMortgageLoan(seat, loanId);
  if (!loan) return { error: 'NO_LOAN' };
  if (!loan.dueThisTurn) return { error: 'NOT_DUE' };
  const due = Math.min(loan.installment, loan.balance);
  if (seat.cash < due) return { error: 'INSUFFICIENT_FUNDS' };
  if (!loan.creditCreditedThisTurn && Math.abs(due - loan.installment) <= 0.01) {
    seat.creditScore = clampCreditScore((seat.creditScore ?? 720) + MORTGAGE_PAYMENT_BONUS);
    loan.creditCreditedThisTurn = true;
  }
  seat.cash = Math.round((seat.cash - due) * 100) / 100;
  loan.balance = Math.round((loan.balance - due) * 100) / 100;
  loan.paymentsMade += 1;
  loan.dueThisTurn = false;
  if (loan.paymentsMade >= loan.term || loan.balance <= 0.0001) {
    loan.balance = 0;
    loan.status = 'closed';
    state.properties[loan.propertyIndex].mortgaged = false;
  }
  refreshMortgageTurnResponded(seat);
  return { ok: true, paid: due, loan };
}

export function skipMortgageInstallment(state, seatIndex, loanId) {
  const seat = state.seats[seatIndex];
  if (!seat) return { error: 'NO_SEAT' };
  const loan = findActiveMortgageLoan(seat, loanId);
  if (!loan) return { error: 'NO_LOAN' };
  if (!loan.dueThisTurn) return { error: 'NOT_DUE' };
  loan.dueThisTurn = false;
  seat.creditScore = clampCreditScore((seat.creditScore ?? 720) - MORTGAGE_MISSED_PENALTY);
  refreshMortgageTurnResponded(seat);
  return { ok: true, loan };
}

export function payoffMortgageLoan(state, seatIndex, loanId) {
  const seat = state.seats[seatIndex];
  if (!seat) return { error: 'NO_SEAT' };
  const loan = findActiveMortgageLoan(seat, loanId);
  if (!loan) return { error: 'NO_LOAN' };
  if (seat.cash < loan.balance) return { error: 'INSUFFICIENT_FUNDS' };
  const paid = loan.balance;
  seat.cash = Math.round((seat.cash - paid) * 100) / 100;
  loan.balance = 0;
  loan.paymentsMade = loan.term;
  loan.dueThisTurn = false;
  loan.status = 'closed';
  state.properties[loan.propertyIndex].mortgaged = false;
  refreshMortgageTurnResponded(seat);
  return { ok: true, paid, loan };
}

export function markMortgageLoansDueAtTurnStart(seat) {
  if (!Array.isArray(seat.mortgageLoans)) return false;
  if (seat?.inJail) {
    seat.mortgageTurnResponded = true;
    return false;
  }
  let anyDue = false;
  for (const loan of seat.mortgageLoans) {
    if (loan.status === 'active' && loan.balance > 0.0001 && loan.paymentsMade < loan.term) {
      loan.dueThisTurn = true;
      loan.creditCreditedThisTurn = false;
      anyDue = true;
    }
  }
  seat.mortgageTurnResponded = !anyDue;
  return anyDue;
}

export function canSellPropertyToBank(state, seatIndex, spaceIndex) {
  const space = BOARD[spaceIndex];
  if (!space || !isOwnable(space)) return { ok: false, error: 'NOT_OWNABLE' };
  const prop = state.properties[spaceIndex];
  if (prop.ownerSeat !== seatIndex) return { ok: false, error: 'NOT_OWNER' };
  if (prop.mortgaged) return { ok: false, error: 'IS_MORTGAGED' };
  if (prop.houses > 0) return { ok: false, error: 'HAS_HOUSES' };
  if (space.type === 'property') {
    for (const i of COLOR_GROUPS[space.colorGroup] ?? []) {
      if (state.properties[i].houses > 0) return { ok: false, error: 'GROUP_HAS_HOUSES' };
    }
  }
  return { ok: true, payout: inflatedPrice(state, space.mortgageValue) };
}

export function sellPropertyToBank(state, seatIndex, spaceIndex) {
  const check = canSellPropertyToBank(state, seatIndex, spaceIndex);
  if (!check.ok) return check;
  const space = BOARD[spaceIndex];
  const seat = state.seats[seatIndex];
  const prop = state.properties[spaceIndex];
  const payout = inflatedPrice(state, space.mortgageValue);
  prop.ownerSeat = null;
  prop.mortgaged = false;
  prop.houses = 0;
  seat.cash = Math.round((seat.cash + payout) * 100) / 100;
  return { ok: true, payout };
}
