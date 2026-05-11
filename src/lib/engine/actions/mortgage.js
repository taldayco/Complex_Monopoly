// Structured-mortgage actions: request, pay/skip installment, payoff, and
// sell-back-to-bank. Each delegates to engine/mortgage.js and emits the
// matching log event.

import {
  requestMortgageLoan as requestMortgageLoanFn,
  payMortgageInstallment as payMortgageInstallmentFn,
  skipMortgageInstallment as skipMortgageInstallmentFn,
  payoffMortgageLoan as payoffMortgageLoanFn,
  sellPropertyToBank as sellPropertyToBankFn
} from '../mortgage.js';
import { tryAutoSettle } from '../_helpers.js';

export function doRequestMortgageLoan(state, action, ctx, log) {
  const reserveRate = state.economy?.reserveRate ?? 0;
  const r = requestMortgageLoanFn(
    state,
    action.seat,
    action.spaceIndex,
    action.term,
    action.downPaymentPct ?? 0,
    { reserveRate }
  );
  if (!r.ok) return { error: r.error };
  log('mortgageLoanIssued', action.seat, {
    spaceIndex: action.spaceIndex,
    loanId: r.loan.id,
    principal: r.loan.principal,
    term: r.loan.term,
    ptr: r.loan.ptr,
    downPaymentPct: r.loan.downPaymentPct
  });
  return {};
}

export function doPayMortgageInstallment(state, action, ctx, log) {
  const r = payMortgageInstallmentFn(state, action.seat, action.loanId);
  if (!r.ok) return { error: r.error };
  log('mortgageInstallmentPaid', action.seat, {
    loanId: action.loanId,
    paid: r.paid,
    balance: r.loan.balance,
    closed: r.loan.status === 'closed'
  });
  return {};
}

export function doSkipMortgageInstallment(state, action, ctx, log) {
  const r = skipMortgageInstallmentFn(state, action.seat, action.loanId);
  if (!r.ok) return { error: r.error };
  log('mortgageInstallmentSkipped', action.seat, { loanId: action.loanId });
  return {};
}

export function doPayoffMortgageLoan(state, action, ctx, log) {
  const r = payoffMortgageLoanFn(state, action.seat, action.loanId);
  if (!r.ok) return { error: r.error };
  log('mortgageLoanPaidOff', action.seat, { loanId: action.loanId, paid: r.paid });
  return {};
}

export function doSellPropertyToBank(state, action, ctx, log) {
  const r = sellPropertyToBankFn(state, action.seat, action.spaceIndex);
  if (!r.ok) return { error: r.error };
  log('sellPropertyToBank', action.seat, { spaceIndex: action.spaceIndex, payout: r.payout });
  tryAutoSettle(state, log);
  return {};
}
