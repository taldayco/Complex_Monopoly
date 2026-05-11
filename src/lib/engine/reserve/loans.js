import {
  calcLoanOptions,
  calcMaxStandardLoan,
  clampCreditScore,
  effectiveTier,
  LOAN_TERMS,
  STANDARD_LOAN_MIN_PRINCIPAL,
  STANDARD_LOANS_PER_TURN,
  STANDARD_LOAN_APPLY_CREDIT_PENALTY,
  STANDARD_LOAN_ANTI_HACK_BONUS
} from '../../shared/reserve/loanCatalog.js';
import {
  getCardLineBonusFor,
  getMissedPaymentPenalty,
  getPtrDiscountFor,
  getFirstInstallmentCoverageFor
} from '../../shared/reserve/cardCatalog.js';
import { hasTempEffect } from './eventCards.js';
import { cents } from '../../shared/money.js';
import { newLoanId as genLoanId } from '../../shared/ids.js';
import {
  markDueIfActive,
  applyCreditBonusOnFullPay,
  recordInstallment,
  payoffActiveLoan,
  applySkipPenalty
} from '../_loanLifecycle.js';

export function rollLoanDie(rng) {
  return Math.floor(rng() * 6) + 1;
}

export function requestLoanOffer(seat, principal, roll, opts = {}) {
  if (seat.pendingLoanOffer) return { error: 'OFFER_PENDING' };
  if (typeof principal !== 'number' || !Number.isFinite(principal) || principal <= 0) {
    return { error: 'BAD_AMOUNT' };
  }
  if (principal < STANDARD_LOAN_MIN_PRINCIPAL) return { error: 'PRINCIPAL_BELOW_MIN' };
  if ((seat.standardLoansThisTurn ?? 0) >= STANDARD_LOANS_PER_TURN) {
    return { error: 'LOANS_PER_TURN_EXCEEDED' };
  }
  const tier = effectiveTier(seat);
  if (tier.name === 'Fair' && hasTempEffect(seat, 'fairCreditBlocked')) {
    return { error: 'CREDIT_CRUNCH_BLOCKED' };
  }
  const score = seat.creditScore ?? 0;
  const cardDiscount = getPtrDiscountFor(seat);
  const offer = calcLoanOptions(score, principal, roll, {
    reserveRate: opts.reserveRate,
    boardwalkDiscount: opts.boardwalkDiscount,
    tempRateDiscount: (opts.tempRateDiscount ?? 0) + cardDiscount,
    tierNameOverride: tier.name
  });
  if (!offer) return { error: 'NOT_ELIGIBLE' };
  const cardLineBonus = getCardLineBonusFor(seat);
  let lineMultiplier = 1;
  if (hasTempEffect(seat, 'doubleMaxLine')) lineMultiplier *= 2;
  if (hasTempEffect(seat, 'maxLoanHalved')) lineMultiplier *= 0.5;
  const maxLine = calcMaxStandardLoan(seat, {
    cardLineBonus,
    lineMultiplier
  });
  if (maxLine < STANDARD_LOAN_MIN_PRINCIPAL) return { error: 'BELOW_LINE_FLOOR' };
  if (principal > maxLine) return { error: 'EXCEEDS_MAX_LINE' };
  let zeroInterestApplied = false;
  let options = offer.options;
  if (hasTempEffect(seat, 'zeroInterestNextLoan')) {
    options = options.map((o) => ({
      term: o.term,
      ptr: 0,
      totalDebt: cents(principal),
      installment: cents(principal / o.term)
    }));
    zeroInterestApplied = true;
  }
  seat.pendingLoanOffer = {
    principal: cents(principal),
    roll,
    tier: offer.tier.name,
    maxLine,
    ptrDiscount: cardDiscount,
    zeroInterestApplied,
    bank: opts.bank ?? 'mmcu',
    reserveRateAtOffer: typeof opts.reserveRate === 'number' ? opts.reserveRate : 0,
    boardwalkDiscount: typeof opts.boardwalkDiscount === 'number' ? opts.boardwalkDiscount : 0,
    options
  };
  return { ok: true, offer: seat.pendingLoanOffer };
}

export function acceptLoanOffer(seat, term, now = Date.now()) {
  const offer = seat.pendingLoanOffer;
  if (!offer) return { error: 'NO_OFFER' };
  if (!LOAN_TERMS.includes(term)) return { error: 'BAD_TERM' };
  const opt = offer.options.find((o) => o.term === term);
  if (!opt) return { error: 'BAD_TERM' };
  const loan = {
    id: genLoanId(seat),
    bank: offer.bank ?? 'mmcu',
    principal: offer.principal,
    term,
    ptr: opt.ptr,
    ptrAtIssue: opt.ptr,
    reserveRateAtIssue: offer.reserveRateAtOffer ?? 0,
    totalDebt: opt.totalDebt,
    installment: opt.installment,
    paymentsMade: 0,
    balance: opt.totalDebt,
    takenAt: now,
    dueThisTurn: false,
    status: 'active',
    creditPenaltyApplied: STANDARD_LOAN_APPLY_CREDIT_PENALTY,
    creditCreditedThisTurn: false
  };
  seat.loans.push(loan);
  seat.cash = cents(seat.cash + offer.principal);
  seat.creditScore = clampCreditScore((seat.creditScore ?? 720) - STANDARD_LOAN_APPLY_CREDIT_PENALTY);
  seat.standardLoansThisTurn = (seat.standardLoansThisTurn ?? 0) + 1;
  seat.pendingLoanOffer = null;
  if (offer.zeroInterestApplied && Array.isArray(seat.tempEffects)) {
    const i = seat.tempEffects.findIndex((e) => e?.effectId === 'zeroInterestNextLoan');
    if (i >= 0) seat.tempEffects.splice(i, 1);
  }
  return { ok: true, loan };
}

export function declineLoanOffer(seat) {
  if (!seat.pendingLoanOffer) return { error: 'NO_OFFER' };
  seat.pendingLoanOffer = null;
  return { ok: true };
}

function findActiveLoan(seat, loanId) {
  return seat.loans.find((l) => l.id === loanId && l.status === 'active');
}

// Standard loans dock the credit score at issuance (`creditPenaltyApplied`)
// and refund that penalty when the loan closes — encourages payoff.
function refundApplyPenaltyOnPayoff(seat, loan) {
  const penalty = loan.creditPenaltyApplied ?? 0;
  if (penalty <= 0) return;
  seat.creditScore = clampCreditScore((seat.creditScore ?? 720) + penalty);
  loan.creditPenaltyApplied = 0;
}

export function payLoanInstallment(seat, loanId) {
  const loan = findActiveLoan(seat, loanId);
  if (!loan) return { error: 'NO_LOAN' };
  if (!loan.dueThisTurn) return { error: 'NOT_DUE' };
  const due = Math.min(loan.installment, loan.balance);
  const bankCovers = getFirstInstallmentCoverageFor(seat, loan);
  const seatPays = cents(due - bankCovers);
  if (seat.cash < seatPays) return { error: 'INSUFFICIENT_FUNDS' };
  if (seatPays > 0) seat.cash = cents(seat.cash - seatPays);
  applyCreditBonusOnFullPay(seat, loan, due, STANDARD_LOAN_ANTI_HACK_BONUS);
  if (recordInstallment(loan, due)) refundApplyPenaltyOnPayoff(seat, loan);
  refreshLoanTurnResponded(seat);
  return { ok: true, paid: seatPays, bankCovered: bankCovers, due, loan };
}

export function skipLoanInstallment(seat, loanId) {
  const loan = findActiveLoan(seat, loanId);
  if (!loan) return { error: 'NO_LOAN' };
  if (!loan.dueThisTurn) return { error: 'NOT_DUE' };
  applySkipPenalty(seat, loan, getMissedPaymentPenalty(seat));
  refreshLoanTurnResponded(seat);
  return { ok: true, loan };
}

export function payoffLoan(seat, loanId) {
  const loan = findActiveLoan(seat, loanId);
  if (!loan) return { error: 'NO_LOAN' };
  const r = payoffActiveLoan(seat, loan);
  if (!r.ok) return { error: r.error };
  refundApplyPenaltyOnPayoff(seat, loan);
  refreshLoanTurnResponded(seat);
  return { ok: true, paid: r.paid, loan };
}

export function markLoansDueAtTurnStart(seat) {
  if (seat?.inJail) {
    seat.loanTurnResponded = true;
    return false;
  }
  let anyDue = false;
  for (const loan of seat.loans) {
    if (markDueIfActive(loan)) anyDue = true;
  }
  seat.loanTurnResponded = !anyDue;
  return anyDue;
}

function refreshLoanTurnResponded(seat) {
  const anyStillDue = seat.loans.some(
    (l) => l.status === 'active' && l.dueThisTurn
  );
  seat.loanTurnResponded = !anyStillDue;
}
