// Pending-trade lifecycle. propose stores `state.pendingTrade`; respond either
// runs `executeTrade` or clears the pending trade; cancel just clears it.
// Trades coexist with `settleDebt` (different state slot) so a debtor can
// negotiate their way out of bankruptcy.

import { validateTrade, executeTrade } from '../trade.js';
import { tryAutoSettle } from '../_helpers.js';

export function doProposeTrade(state, action, ctx, log) {
  if (state.pendingAction && state.pendingAction.type !== 'settleDebt') {
    return { error: 'BLOCKED_BY_PENDING' };
  }
  const trade = {
    fromSeat: action.seat,
    toSeat: action.toSeat,
    offer: action.offer ?? { cash: 0, properties: [] },
    request: action.request ?? { cash: 0, properties: [] }
  };
  const v = validateTrade(state, trade);
  if (!v.ok) return { error: v.error };
  state.pendingTrade = trade;
  log('tradeProposed', action.seat, { toSeat: trade.toSeat });
  return {};
}

export function doRespondTrade(state, action, ctx, log) {
  const trade = state.pendingTrade;
  if (!trade) return { error: 'NO_TRADE' };
  if (trade.toSeat !== action.seat) return { error: 'NOT_YOU' };
  if (!action.accept) {
    state.pendingTrade = null;
    log('tradeDeclined', action.seat, null);
    return {};
  }
  const r = executeTrade(state, trade);
  if (!r.ok) {
    state.pendingTrade = null;
    return { error: r.error };
  }
  log('tradeExecuted', action.seat, {
    fromSeat: trade.fromSeat,
    toSeat: trade.toSeat,
    offer: trade.offer,
    request: trade.request
  });
  state.pendingTrade = null;
  tryAutoSettle(state, log);
  return {};
}

export function doCancelTrade(state, action, ctx, log) {
  if (!state.pendingTrade) return { error: 'NO_TRADE' };
  if (state.pendingTrade.fromSeat !== action.seat) return { error: 'NOT_YOURS' };
  state.pendingTrade = null;
  log('tradeCancelled', action.seat, null);
  return {};
}
