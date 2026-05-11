import { BOARD, isOwnable } from '../shared/board.js';
import { COLOR_GROUPS } from '../shared/constants.js';
import { inflatedPrice } from '../shared/economy/inflation.js';
import { cents, round4 } from '../shared/money.js';
import { getTierByScore } from '../shared/reserve/loanCatalog.js';
import {
  markDueIfActive,
  applyCreditBonusOnFullPay,
  recordInstallment,
  payoffActiveLoan,
  applySkipPenalty
} from './_loanLifecycle.js';

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

import { newMortgageLoanId } from '../shared/ids.js';
const genMortgageLoanId = newMortgageLoanId;

export function downPaymentDiscount(pct) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return 0;
  if (pct >= 0.5) return 0.03;
  if (pct >= 0.25) return 0.02;
  if (pct > 0) return 0.01;
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
  const ptr = Math.max(0, round4(baseRate + reserveRate - dpDiscount));
  const downPaymentAmount = cents(space.mortgageValue * downPaymentPct);
  if ((seat?.cash ?? 0) < downPaymentAmount) return { error: 'INSUFFICIENT_FUNDS_FOR_DOWN_PAYMENT' };
  const principal = cents(space.mortgageValue * (1 - downPaymentPct));
  const totalDebt = cents(principal * (1 + ptr * term));
  const installment = cents(totalDebt / term);
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
  seat.cash = cents(seat.cash + offer.principal - offer.downPaymentAmount);
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
  applyCreditBonusOnFullPay(seat, loan, due, MORTGAGE_PAYMENT_BONUS);
  seat.cash = cents(seat.cash - due);
  if (recordInstallment(loan, due)) {
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
  applySkipPenalty(seat, loan, MORTGAGE_MISSED_PENALTY);
  refreshMortgageTurnResponded(seat);
  return { ok: true, loan };
}

export function payoffMortgageLoan(state, seatIndex, loanId) {
  const seat = state.seats[seatIndex];
  if (!seat) return { error: 'NO_SEAT' };
  const loan = findActiveMortgageLoan(seat, loanId);
  if (!loan) return { error: 'NO_LOAN' };
  const r = payoffActiveLoan(seat, loan);
  if (!r.ok) return { error: r.error };
  state.properties[loan.propertyIndex].mortgaged = false;
  refreshMortgageTurnResponded(seat);
  return { ok: true, paid: r.paid, loan };
}

export function markMortgageLoansDueAtTurnStart(seat) {
  if (!Array.isArray(seat.mortgageLoans)) return false;
  if (seat?.inJail) {
    seat.mortgageTurnResponded = true;
    return false;
  }
  let anyDue = false;
  for (const loan of seat.mortgageLoans) {
    if (markDueIfActive(loan)) anyDue = true;
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
  seat.cash = cents(seat.cash + payout);
  return { ok: true, payout };
}
