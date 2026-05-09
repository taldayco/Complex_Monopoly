// Engine-side loan helpers. Mutate the seat slice they are given; callers
// (the reducer) work on a structuredClone of the room.

import {
  calcLoanOptions,
  MIN_CREDIT_SCORE,
  LOAN_TERMS
} from '../../shared/reserve/loanCatalog.js';
import {
  getMaxLineFor,
  getMissedPaymentPenalty,
  getPtrDiscountFor,
  getFirstInstallmentCoverageFor
} from '../../shared/reserve/cardCatalog.js';

let LOAN_ID_COUNTER = 0;

function genLoanId(seat) {
  LOAN_ID_COUNTER += 1;
  return `L-${seat.seat}-${(seat.loans?.length ?? 0)}-${LOAN_ID_COUNTER}`;
}

// Roll a single d6 from the injected RNG. Returns 1..6.
export function rollLoanDie(rng) {
  return Math.floor(rng() * 6) + 1;
}

// ---------- OFFER ----------

export function requestLoanOffer(seat, principal, roll) {
  if (seat.pendingLoanOffer) return { error: 'OFFER_PENDING' };
  if (typeof principal !== 'number' || !Number.isFinite(principal) || principal <= 0) {
    return { error: 'BAD_AMOUNT' };
  }
  const score = seat.creditScore ?? 0;
  const offer = calcLoanOptions(score, principal, roll);
  if (!offer) return { error: 'NOT_ELIGIBLE' };
  // Cards can boost a seat's max line; use the seat-aware ceiling.
  const maxLine = getMaxLineFor(seat);
  if (principal > maxLine) return { error: 'OVER_MAX_LINE' };
  // Cards can also discount the per-turn rate; apply uniformly across terms.
  const discount = getPtrDiscountFor(seat);
  const adjustedOptions = discount > 0
    ? offer.options.map((o) => {
        const ptr = Math.max(0, Math.round((o.ptr - discount) * 10000) / 10000);
        const totalDebt = Math.round(principal * (1 + ptr * o.term) * 100) / 100;
        const installment = Math.round((totalDebt / o.term) * 100) / 100;
        return { term: o.term, ptr, totalDebt, installment };
      })
    : offer.options;
  seat.pendingLoanOffer = {
    principal: Math.round(principal * 100) / 100,
    roll,
    tier: offer.tier.name,
    maxLine,
    ptrDiscount: discount,
    options: adjustedOptions
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
    principal: offer.principal,
    term,
    ptr: opt.ptr,
    totalDebt: opt.totalDebt,
    installment: opt.installment,
    paymentsMade: 0,
    balance: opt.totalDebt,
    takenAt: now,
    dueThisTurn: false,
    status: 'active'
  };
  seat.loans.push(loan);
  seat.cash = Math.round((seat.cash + offer.principal) * 100) / 100;
  seat.pendingLoanOffer = null;
  return { ok: true, loan };
}

export function declineLoanOffer(seat) {
  if (!seat.pendingLoanOffer) return { error: 'NO_OFFER' };
  seat.pendingLoanOffer = null;
  return { ok: true };
}

// ---------- PAYMENTS ----------

function findActiveLoan(seat, loanId) {
  return seat.loans.find((l) => l.id === loanId && l.status === 'active');
}

export function payLoanInstallment(seat, loanId) {
  const loan = findActiveLoan(seat, loanId);
  if (!loan) return { error: 'NO_LOAN' };
  if (!loan.dueThisTurn) return { error: 'NOT_DUE' };
  const due = Math.min(loan.installment, loan.balance);
  // vaultPlatinum: bank covers part of the first installment, capped so the
  // bank's net recovery stays at least principal + $100. Player pays the rest
  // out of cash; the loan balance is reduced by the full `due`.
  const bankCovers = getFirstInstallmentCoverageFor(seat, loan);
  const seatPays = Math.round((due - bankCovers) * 100) / 100;
  if (seat.cash < seatPays) return { error: 'INSUFFICIENT_FUNDS' };
  if (seatPays > 0) {
    seat.cash = Math.round((seat.cash - seatPays) * 100) / 100;
  }
  loan.balance = Math.round((loan.balance - due) * 100) / 100;
  loan.paymentsMade += 1;
  loan.dueThisTurn = false;
  if (loan.paymentsMade >= loan.term || loan.balance <= 0.0001) {
    loan.balance = 0;
    loan.status = 'closed';
  }
  refreshLoanTurnResponded(seat);
  return { ok: true, paid: seatPays, bankCovered: bankCovers, due, loan };
}

export function skipLoanInstallment(seat, loanId) {
  const loan = findActiveLoan(seat, loanId);
  if (!loan) return { error: 'NO_LOAN' };
  if (!loan.dueThisTurn) return { error: 'NOT_DUE' };
  // The skipped installment stays on the balance; paymentsMade is not
  // incremented, which extends the loan's effective duration. Player eats a
  // credit-score hit (softened by certain cards, e.g. Vault Platinum).
  loan.dueThisTurn = false;
  seat.creditScore = Math.max(
    MIN_CREDIT_SCORE,
    (seat.creditScore ?? 720) - getMissedPaymentPenalty(seat)
  );
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
  refreshLoanTurnResponded(seat);
  return { ok: true, paid, loan };
}

// ---------- TURN HOOKS ----------

// Called when a seat's turn starts. Marks every active loan due, and clears
// `loanTurnResponded` so the seat must respond before rolling.
export function markLoansDueAtTurnStart(seat) {
  let anyDue = false;
  for (const loan of seat.loans) {
    if (loan.status === 'active' && loan.balance > 0.0001 && loan.paymentsMade < loan.term) {
      loan.dueThisTurn = true;
      anyDue = true;
    }
  }
  seat.loanTurnResponded = !anyDue;
  return anyDue;
}

// After any per-loan response (pay/skip/payoff), recompute the seat-level
// flag — true once every active loan has been responded to.
function refreshLoanTurnResponded(seat) {
  const anyStillDue = seat.loans.some(
    (l) => l.status === 'active' && l.dueThisTurn
  );
  seat.loanTurnResponded = !anyStillDue;
}
