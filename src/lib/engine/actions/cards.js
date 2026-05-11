// Credit-card actions: apply, request line increase, cancel, pay balance.
// Each delegates to engine/reserve/cards.js.

import {
  applyForCard,
  cancelCard,
  payCardBalance,
  requestCreditLineIncrease
} from '../reserve/cards.js';

export function doRequestCreditCard(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat || seat.bankrupt) return { error: 'BANKRUPT' };
  const r = applyForCard(seat, action.cardId, state.turnCount ?? 0, Date.now());
  if (!r.ok) return { error: r.error };
  log('cardAcquired', action.seat, {
    cardId: action.cardId,
    instanceId: r.card.id,
    signingFee: r.signingFee,
    signupBonus: r.signupBonus
  });
  return {};
}

export function doRequestCreditLineIncrease(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat || seat.bankrupt) return { error: 'BANKRUPT' };
  const r = requestCreditLineIncrease(seat, action.instanceId);
  if (!r.ok) return { error: r.error };
  log('creditLineIncreaseRequested', action.seat, {
    instanceId: action.instanceId,
    oldLine: r.oldLine,
    newLine: r.newLine,
    increased: r.increased
  });
  return {};
}

export function doCancelCreditCard(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  const r = cancelCard(seat, action.instanceId);
  if (!r.ok) return { error: r.error };
  log('cardCancelled', action.seat, {
    instanceId: action.instanceId,
    cancelFee: r.cancelFee
  });
  return {};
}

export function doPayCardBalance(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  const r = payCardBalance(seat, action.instanceId, action.amount);
  if (!r.ok) return { error: r.error };
  log('cardPayment', action.seat, {
    instanceId: action.instanceId,
    paid: r.paid,
    balance: r.balance
  });
  return {};
}
