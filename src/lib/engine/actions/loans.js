// Standard-loan actions: request offer, accept/decline, pay/skip installment,
// payoff. Each handler delegates to engine/reserve/loans.js and emits the
// matching log event.

import {
  rollLoanDie,
  requestLoanOffer,
  acceptLoanOffer,
  declineLoanOffer,
  payLoanInstallment,
  skipLoanInstallment,
  payoffLoan
} from '../reserve/loans.js';
import { eligibleForBoardwalkDiscount } from '../reserve/banking.js';
import { BANKS } from '../../shared/reserve/economyCatalog.js';
import { getTierByScore } from '../../shared/reserve/loanCatalog.js';

export function doRequestLoan(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat || seat.bankrupt) return { error: 'BANKRUPT' };
  const bank = action.bank ?? 'mmcu';
  if (!BANKS[bank]) return { error: 'UNKNOWN_BANK' };
  if (bank === 'boardwalk') {
    const tier = getTierByScore(seat.creditScore ?? 0).name;
    if (tier !== 'Very Good' && tier !== 'Excellent') {
      return { error: 'BOARDWALK_TIER_GATE' };
    }
  }
  const reserveRate = state.economy?.reserveRate ?? 0;
  const boardwalkDiscount =
    bank === 'boardwalk' && eligibleForBoardwalkDiscount(seat)
      ? BANKS.boardwalk.loanDiscountIfMmFree
      : 0;
  const roll = rollLoanDie(ctx.rng);
  state.rngCursor++;
  const r = requestLoanOffer(seat, action.amount, roll, {
    bank,
    reserveRate,
    boardwalkDiscount
  });
  if (!r.ok) return { error: r.error };
  log('loanOffer', action.seat, {
    bank,
    principal: r.offer.principal,
    roll,
    tier: r.offer.tier,
    reserveRate,
    boardwalkDiscount,
    options: r.offer.options
  });
  return {};
}

export function doRespondLoanOffer(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  if (action.decline) {
    const r = declineLoanOffer(seat);
    if (!r.ok) return { error: r.error };
    log('loanDeclined', action.seat, null);
    return {};
  }
  const r = acceptLoanOffer(seat, action.term, Date.now());
  if (!r.ok) return { error: r.error };
  log('loanAccepted', action.seat, {
    loanId: r.loan.id,
    principal: r.loan.principal,
    term: r.loan.term,
    ptr: r.loan.ptr,
    totalDebt: r.loan.totalDebt
  });
  return {};
}

export function doPayLoanInstallment(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  const r = payLoanInstallment(seat, action.loanId);
  if (!r.ok) return { error: r.error };
  log('loanPayment', action.seat, {
    loanId: action.loanId,
    paid: r.paid,
    bankCovered: r.bankCovered ?? 0,
    due: r.due,
    balance: r.loan.balance,
    closed: r.loan.status === 'closed'
  });
  return {};
}

export function doSkipLoanInstallment(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  const r = skipLoanInstallment(seat, action.loanId);
  if (!r.ok) return { error: r.error };
  log('loanSkipped', action.seat, {
    loanId: action.loanId,
    creditScore: seat.creditScore
  });
  return {};
}

export function doPayoffLoan(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  const r = payoffLoan(seat, action.loanId);
  if (!r.ok) return { error: r.error };
  log('loanPaidOff', action.seat, { loanId: action.loanId, paid: r.paid });
  return {};
}
