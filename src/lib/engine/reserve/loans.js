import {
  calcLoanOptions,
  calcMaxStandardLoan,
  clampCreditScore,
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

let LOAN_ID_COUNTER = 0;

function genLoanId(seat) {
  LOAN_ID_COUNTER += 1;
  return `L-${seat.seat}-${(seat.loans?.length ?? 0)}-${LOAN_ID_COUNTER}`;
}

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
  const score = seat.creditScore ?? 0;
  const cardDiscount = getPtrDiscountFor(seat);
  const offer = calcLoanOptions(score, principal, roll, {
    reserveRate: opts.reserveRate,
    boardwalkDiscount: opts.boardwalkDiscount,
    tempRateDiscount: (opts.tempRateDiscount ?? 0) + cardDiscount
  });
  if (!offer) return { error: 'NOT_ELIGIBLE' };
  const cardLineBonus = getCardLineBonusFor(seat);
  const maxLine = calcMaxStandardLoan(seat, {
    cardLineBonus,
    tempBoost: opts.tempLineBoost ?? 0
  });
  if (maxLine < STANDARD_LOAN_MIN_PRINCIPAL) return { error: 'BELOW_LINE_FLOOR' };
  if (principal > maxLine) return { error: 'EXCEEDS_MAX_LINE' };
  seat.pendingLoanOffer = {
    principal: Math.round(principal * 100) / 100,
    roll,
    tier: offer.tier.name,
    maxLine,
    ptrDiscount: cardDiscount,
    bank: opts.bank ?? 'mmcu',
    reserveRateAtOffer: typeof opts.reserveRate === 'number' ? opts.reserveRate : 0,
    boardwalkDiscount: typeof opts.boardwalkDiscount === 'number' ? opts.boardwalkDiscount : 0,
    options: offer.options
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
  seat.cash = Math.round((seat.cash + offer.principal) * 100) / 100;
  seat.creditScore = clampCreditScore((seat.creditScore ?? 720) - STANDARD_LOAN_APPLY_CREDIT_PENALTY);
  seat.standardLoansThisTurn = (seat.standardLoansThisTurn ?? 0) + 1;
  seat.pendingLoanOffer = null;
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

function applyAntiHackBonus(seat, loan, due, paid) {
  if (loan.creditCreditedThisTurn) return false;
  if (!loan.dueThisTurn) return false;
  if (Math.abs(paid - due) > 0.01) return false;
  seat.creditScore = clampCreditScore((seat.creditScore ?? 720) + STANDARD_LOAN_ANTI_HACK_BONUS);
  loan.creditCreditedThisTurn = true;
  return true;
}

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
  const seatPays = Math.round((due - bankCovers) * 100) / 100;
  if (seat.cash < seatPays) return { error: 'INSUFFICIENT_FUNDS' };
  if (seatPays > 0) {
    seat.cash = Math.round((seat.cash - seatPays) * 100) / 100;
  }
  applyAntiHackBonus(seat, loan, due, due);
  loan.balance = Math.round((loan.balance - due) * 100) / 100;
  loan.paymentsMade += 1;
  loan.dueThisTurn = false;
  if (loan.paymentsMade >= loan.term || loan.balance <= 0.0001) {
    loan.balance = 0;
    loan.status = 'closed';
    refundApplyPenaltyOnPayoff(seat, loan);
  }
  refreshLoanTurnResponded(seat);
  return { ok: true, paid: seatPays, bankCovered: bankCovers, due, loan };
}

export function skipLoanInstallment(seat, loanId) {
  const loan = findActiveLoan(seat, loanId);
  if (!loan) return { error: 'NO_LOAN' };
  if (!loan.dueThisTurn) return { error: 'NOT_DUE' };
  loan.dueThisTurn = false;
  seat.creditScore = clampCreditScore((seat.creditScore ?? 720) - getMissedPaymentPenalty(seat));
  refreshLoanTurnResponded(seat);
  return { ok: true, loan };
}

export function payoffLoan(seat, loanId) {
  const loan = findActiveLoan(seat, loanId);
  if (!loan) return { error: 'NO_LOAN' };
  if (seat.cash < loan.balance) return { error: 'INSUFFICIENT_FUNDS' };
  const paid = loan.balance;
  seat.cash = Math.round((seat.cash - paid) * 100) / 100;
  loan.balance = 0;
  loan.paymentsMade = loan.term;
  loan.dueThisTurn = false;
  loan.status = 'closed';
  refundApplyPenaltyOnPayoff(seat, loan);
  refreshLoanTurnResponded(seat);
  return { ok: true, paid, loan };
}

export function markLoansDueAtTurnStart(seat) {
  let anyDue = false;
  if (seat?.inJail) {
    seat.loanTurnResponded = true;
    return false;
  }
  for (const loan of seat.loans) {
    if (loan.status === 'active' && loan.balance > 0.0001 && loan.paymentsMade < loan.term) {
      loan.dueThisTurn = true;
      loan.creditCreditedThisTurn = false;
      anyDue = true;
    }
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
