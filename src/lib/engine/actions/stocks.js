// Stock-market actions: buy with cash, buy with credit card, sell. Plus the
// server-injected market-open tick.

import { buyShares, sellShares } from '../reserve/stocks.js';
import { chargeCard } from '../reserve/cards.js';
import { applyMarketOpenTick } from '../reserve/marketOpen.js';
import { cents } from '../../shared/money.js';

export function doBuyStock(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat || seat.bankrupt) return { error: 'BANKRUPT' };
  const r = buyShares(seat, state.stocks, action.symbol, action.qty);
  if (!r.ok) return { error: r.error };
  log('buyStock', action.seat, { symbol: action.symbol, qty: r.qty, cost: r.cost, price: r.price });
  return {};
}

// Buy stock funded by a credit card. Bypasses buyShares' cash gate — the
// charge goes directly on the card balance, then we credit shares and bump
// cost basis manually. Cost basis tracks the dollar value of the purchase
// regardless of funding source so realised P&L stays consistent.
export function doBuyStockWithCard(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat || seat.bankrupt) return { error: 'BANKRUPT' };
  const symbol = action.symbol;
  const qty = action.qty;
  const market = state.stocks?.market?.[symbol];
  if (!market) return { error: 'UNKNOWN_STOCK' };
  if (!Number.isInteger(qty) || qty <= 0) return { error: 'BAD_QTY' };
  const price = market.price ?? 0;
  const cost = cents(price * qty);
  const charge = chargeCard(seat, action.instanceId, cost);
  if (!charge.ok) return { error: charge.error };
  seat.stockLots[symbol] = (seat.stockLots[symbol] || 0) + qty;
  seat.stockCostBasis[symbol] = cents((seat.stockCostBasis[symbol] || 0) + cost);
  log('buyStockWithCard', action.seat, {
    symbol, qty, cost, price,
    instanceId: action.instanceId,
    cardBalance: charge.balance,
    creditLine: charge.limit
  });
  return {};
}

export function doSellStock(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat || seat.bankrupt) return { error: 'BANKRUPT' };
  const r = sellShares(seat, state.stocks, action.symbol, action.qty);
  if (!r.ok) return { error: r.error };
  log('sellStock', action.seat, { symbol: action.symbol, qty: r.qty, proceeds: r.proceeds, price: r.price });
  return {};
}

// Server-injected tick driving the Market Open window. Each tick applies the
// next pre-rolled flip frame to the live stocks, decrements the remaining
// counter, and either schedules the next tick or closes the window.
export function doMarketOpenTick(state, action, ctx, log) {
  if (!action._server) return { error: 'NOT_AUTHORIZED' };
  if (!state.marketOpen?.active) return { error: 'NO_MARKET_OPEN' };
  const tickIndex = state.marketOpen.ticksFired;
  const r = applyMarketOpenTick(state);
  if (r.error) return { error: r.error };
  log('marketOpenTick', null, {
    tickIndex,
    results: r.results ?? null,
    done: !!r.done
  });
  if (r.done) {
    log('marketOpenEnd', null, null);
  } else {
    log('marketTickScheduled', null, { nextTickAtMs: r.nextTickAtMs });
  }
  return {};
}
