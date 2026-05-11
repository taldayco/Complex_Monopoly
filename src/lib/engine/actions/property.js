// Property acquisition + house construction. The buy flows resolve a pending
// `buyDecision` (cash, mortgage, or credit card); house buy/sell go straight
// to engine/building.js.

import { BOARD } from '../../shared/board.js';
import { BUY_MORTGAGE_PTR, BUY_MORTGAGE_TERMS } from '../../shared/constants.js';
import { buyProperty as buyPropertyFn, transferOwnership } from '../purchase.js';
import { canBuyHouse, buyHouse as buyHouseFn, canSellHouse, sellHouse as sellHouseFn } from '../building.js';
import { chargeCard } from '../reserve/cards.js';
import { getTierByScore } from '../../shared/reserve/loanCatalog.js';
import { newMortgageLoanId } from '../../shared/ids.js';
import { recomputePhase, tryAutoSettle } from '../_helpers.js';
import { cents } from '../../shared/money.js';

export function doBuyProperty(state, action, ctx, log) {
  const pa = state.pendingAction;
  if (!pa || pa.type !== 'buyDecision') return { error: 'NO_BUY_DECISION' };
  if (pa.seat !== action.seat) return { error: 'NOT_YOUR_DECISION' };
  const result = buyPropertyFn(state, action.seat, pa.spaceIndex);
  if (!result.ok) return { error: result.error };
  log('buy', action.seat, { spaceIndex: pa.spaceIndex, price: result.price });
  state.pendingAction = null;
  recomputePhase(state);
  return {};
}

export function doDeclineToBuy(state, action, ctx, log) {
  const pa = state.pendingAction;
  if (!pa || pa.type !== 'buyDecision') return { error: 'NO_BUY_DECISION' };
  if (pa.seat !== action.seat) return { error: 'NOT_YOUR_DECISION' };
  state.pendingAuctions.push({
    spaceIndex: pa.spaceIndex,
    declinedBy: action.seat,
    reason: 'declined'
  });
  state.pendingAction = null;
  log('auctionQueued', action.seat, { spaceIndex: pa.spaceIndex, reason: 'declined' });
  recomputePhase(state);
  return {};
}

// Finance the property purchase as a 5- or 10-installment mortgage at fixed
// 10% per-turn interest. Property transfers immediately; the debt rides on
// the existing loan plumbing as a `seat.loans[]` entry tagged source: 'mortgage'.
export function doBuyPropertyWithMortgage(state, action, ctx, log) {
  const pa = state.pendingAction;
  if (!pa || pa.type !== 'buyDecision') return { error: 'NO_BUY_DECISION' };
  if (pa.seat !== action.seat) return { error: 'NOT_YOUR_DECISION' };
  if (typeof action.spaceIndex === 'number' && action.spaceIndex !== pa.spaceIndex) {
    return { error: 'SPACE_MISMATCH' };
  }
  const term = action.term;
  if (!BUY_MORTGAGE_TERMS.includes(term)) return { error: 'BAD_TERM' };
  const seat = state.seats[action.seat];
  if (seat.bankrupt) return { error: 'BANKRUPT' };
  if (getTierByScore(seat.creditScore ?? 0).name === 'Poor') {
    return { error: 'NOT_ELIGIBLE' };
  }

  const result = transferOwnership(state, action.seat, pa.spaceIndex);
  if (!result.ok) return { error: result.error };
  const { price } = result;

  const principal = price;
  const ptr = BUY_MORTGAGE_PTR;
  const totalDebt = cents(principal * (1 + ptr * term));
  const installment = cents(totalDebt / term);
  const loan = {
    id: newMortgageLoanId(seat),
    principal,
    term,
    ptr,
    totalDebt,
    installment,
    paymentsMade: 0,
    balance: totalDebt,
    takenAt: Date.now(),
    dueThisTurn: false,
    status: 'active',
    source: 'mortgage',
    propertyIndex: pa.spaceIndex,
    propertyName: BOARD[pa.spaceIndex].name
  };
  seat.loans.push(loan);

  log('buyWithMortgage', action.seat, {
    spaceIndex: pa.spaceIndex,
    price,
    term,
    ptr,
    totalDebt,
    installment,
    loanId: loan.id
  });
  state.pendingAction = null;
  recomputePhase(state);
  return {};
}

// Charge a property purchase to a specific credit card. Property transfers
// immediately; the price lands on the card balance and accrues interest at
// the card's catalog rate every 4-turn cycle. Per-card minLine caps the
// charge — a too-large purchase rejects with INSUFFICIENT_CREDIT before any
// state mutation, so partial-failure rollback is unnecessary.
export function doBuyPropertyWithCard(state, action, ctx, log) {
  const pa = state.pendingAction;
  if (!pa || pa.type !== 'buyDecision') return { error: 'NO_BUY_DECISION' };
  if (pa.seat !== action.seat) return { error: 'NOT_YOUR_DECISION' };
  if (typeof action.spaceIndex === 'number' && action.spaceIndex !== pa.spaceIndex) {
    return { error: 'SPACE_MISMATCH' };
  }
  const seat = state.seats[action.seat];
  if (seat.bankrupt) return { error: 'BANKRUPT' };
  const charge = chargeCard(seat, action.instanceId, pa.price);
  if (!charge.ok) return { error: charge.error };
  const result = transferOwnership(state, action.seat, pa.spaceIndex);
  if (!result.ok) {
    // Rollback the optimistic charge so a transferOwnership rejection (e.g.
    // racing OWNED) doesn't leave the player charged for nothing.
    const inst = seat.creditCards.find((c) => c.id === action.instanceId);
    if (inst) inst.balance = cents((inst.balance ?? 0) - pa.price);
    return { error: result.error };
  }
  log('buyWithCard', action.seat, {
    spaceIndex: pa.spaceIndex,
    price: pa.price,
    instanceId: action.instanceId,
    cardBalance: charge.balance,
    creditLine: charge.limit
  });
  state.pendingAction = null;
  recomputePhase(state);
  return {};
}

export function doBuyHouse(state, action, ctx, log) {
  // Cannot build during a pending action (settleDebt allows selling, not buying).
  if (state.pendingAction && state.pendingAction.type !== 'trade') {
    return { error: 'BLOCKED_BY_PENDING' };
  }
  const r = buyHouseFn(state, action.seat, action.spaceIndex);
  if (!r.ok) return { error: r.error };
  log('buyHouse', action.seat, { spaceIndex: action.spaceIndex, houses: r.houses, cost: r.cost });
  return {};
}

export function doSellHouse(state, action, ctx, log) {
  const r = sellHouseFn(state, action.seat, action.spaceIndex);
  if (!r.ok) return { error: r.error };
  log('sellHouse', action.seat, { spaceIndex: action.spaceIndex, houses: r.houses, refund: r.refund });
  tryAutoSettle(state, log);
  return {};
}
