// Shared installment-loan lifecycle primitives. Used by both the standard-loan
// module (loans.js) and the structured-mortgage module (mortgage.js), which
// historically duplicated this code line-for-line — same pay/skip/payoff/
// markDue logic with only the credit-bonus value, the close-side-effect, and
// the per-kind "responded" flag differing between them.

import { clampCreditScore } from '../shared/reserve/loanCatalog.js';
import { cents } from '../shared/money.js';

// Mark `loan` due at the start of a turn iff it is still active with a real
// outstanding balance. Returns true iff this loan was marked. Does not touch
// any seat-level "loanTurnResponded" flag — caller decides which flag to set.
export function markDueIfActive(loan) {
  if (loan?.status !== 'active') return false;
  if (!(loan.balance > 0.0001)) return false;
  if (loan.paymentsMade >= loan.term) return false;
  loan.dueThisTurn = true;
  loan.creditCreditedThisTurn = false;
  return true;
}

// Award a one-time-per-turn credit-score bump for a fully-paid installment.
// `bonus` differs by loan kind — standard loans use STANDARD_LOAN_ANTI_HACK_BONUS,
// mortgages use MORTGAGE_PAYMENT_BONUS. Returns true iff the bonus was applied.
export function applyCreditBonusOnFullPay(seat, loan, due, bonus) {
  if (loan.creditCreditedThisTurn) return false;
  if (!loan.dueThisTurn) return false;
  if (Math.abs(due - loan.installment) > 0.01) return false;
  seat.creditScore = clampCreditScore((seat.creditScore ?? 720) + bonus);
  loan.creditCreditedThisTurn = true;
  return true;
}

// Record a paid installment against the loan: subtract balance, bump
// paymentsMade, clear dueThisTurn, and close the loan if it's paid off.
// Returns true iff the loan just closed.
export function recordInstallment(loan, due) {
  loan.balance = cents(loan.balance - due);
  loan.paymentsMade += 1;
  loan.dueThisTurn = false;
  if (loan.paymentsMade >= loan.term || loan.balance <= 0.0001) {
    loan.balance = 0;
    loan.status = 'closed';
    return true;
  }
  return false;
}

// Lump-sum payoff. Caller is responsible for any post-close side effects
// (refunding credit penalty, unmortgaging the property, etc.).
export function payoffActiveLoan(seat, loan) {
  if (seat.cash < loan.balance) return { error: 'INSUFFICIENT_FUNDS' };
  const paid = loan.balance;
  seat.cash = cents(seat.cash - paid);
  loan.balance = 0;
  loan.paymentsMade = loan.term;
  loan.dueThisTurn = false;
  loan.status = 'closed';
  return { ok: true, paid };
}

// Skip an installment: docks the credit score by `penalty` and clears
// dueThisTurn. The loan remains active; the missed payment isn't capitalized.
export function applySkipPenalty(seat, loan, penalty) {
  loan.dueThisTurn = false;
  seat.creditScore = clampCreditScore((seat.creditScore ?? 720) - penalty);
}
