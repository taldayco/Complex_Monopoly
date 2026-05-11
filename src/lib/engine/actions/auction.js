// Free-for-all property auctions. Triggered when a landed-on space is declined
// (or unaffordable). Runs to a per-attempt timer; if no one bids, cascades to
// the next attempt at a lower start price; final attempt randomly assigns.

import {
  createAuction,
  applyBid,
  shouldSettleEarly,
  isExpired,
  settle as settleAuctionFn,
  randomAssign as randomAssignAuctionFn,
  AUCTION_ATTEMPT_FRACTIONS
} from '../auction.js';
import { continueEndTurnFlow } from './turn.js';

// Free-for-all bidding. Any non-bankrupt seat may bid; each accepted bid resets
// the timer. Settled by `doAuctionTick` (server-injected on timer expiry) or
// early when only one seat can still afford to outbid.
export function doBid(state, action, ctx, log) {
  const pa = state.pendingAction;
  if (!pa || pa.type !== 'auction') return { error: 'NO_AUCTION' };
  const r = applyBid(state, pa, action.seat, action.amount);
  if (!r.ok) return { error: r.error };
  log('bid', action.seat, { amount: pa.currentBid, endsAtMs: pa.endsAtMs });
  if (shouldSettleEarly(state, pa)) {
    finalizeAuction(state, ctx, log);
  }
  return {};
}

// Server-injected only — fires when the auction window expires.
export function doAuctionTick(state, action, ctx, log) {
  if (!action._server) return { error: 'CLIENT_TICK' };
  const pa = state.pendingAction;
  if (!pa || pa.type !== 'auction') return { error: 'NO_AUCTION' };
  if (!isExpired(pa)) return { error: 'NOT_EXPIRED' };
  finalizeAuction(state, ctx, log);
  return {};
}

export function finalizeAuction(state, ctx, log) {
  const pa = state.pendingAction;
  if (pa.currentBid === 0) {
    const nextAttempt = (pa.attempt ?? 0) + 1;
    if (nextAttempt < AUCTION_ATTEMPT_FRACTIONS.length) {
      const auction = createAuction(pa.spaceIndex, nextAttempt);
      state.pendingAction = auction;
      log('auctionStart', null, {
        spaceIndex: pa.spaceIndex,
        attempt: nextAttempt,
        startPrice: auction.startPrice,
        endsAtMs: auction.endsAtMs,
        reason: 'cascadeNoBid'
      });
      return;
    }
    const r = randomAssignAuctionFn(state, pa.spaceIndex, ctx?.rng);
    log('auctionEnd', null, {
      spaceIndex: pa.spaceIndex,
      soldTo: r.soldTo,
      price: 0,
      randomized: true
    });
    state.pendingAction = null;
    continueEndTurnFlow(state, ctx, log);
    return;
  }
  const result = settleAuctionFn(state, pa);
  log('auctionEnd', null, {
    spaceIndex: pa.spaceIndex,
    soldTo: result.soldTo,
    price: result.price
  });
  state.pendingAction = null;
  // Continue the deferred end-turn flow: either start the next queued auction
  // or finally advance the turn.
  continueEndTurnFlow(state, ctx, log);
}
