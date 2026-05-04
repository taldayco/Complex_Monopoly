import { AUCTION_INCREMENT, AUCTION_MIN_BID, AUCTION_DURATION_MS } from '../shared/constants.js';

// Auction model: timed free-for-all. The current pendingAction shape is
//   { type: 'auction', spaceIndex, currentBid, highBidder, endsAtMs, lastBidAtMs }
// Any non-bankrupt seat may bid at any time during the window. Each accepted
// bid resets the timer to AUCTION_DURATION_MS from now. The auction settles
// when the timer hits 0 or when ≤ 1 seat can afford the next minimum bid.
// No bids → property remains unowned.

export function createAuction(spaceIndex, now = Date.now()) {
  return {
    type: 'auction',
    spaceIndex,
    currentBid: 0,
    highBidder: null,
    endsAtMs: now + AUCTION_DURATION_MS,
    lastBidAtMs: null
  };
}

export function nextMinBid(auction) {
  return Math.max(AUCTION_MIN_BID, auction.currentBid + AUCTION_INCREMENT);
}

// Count non-bankrupt seats that could still raise the current bid. Used to
// detect the early-end condition: when no second bidder can outbid the high
// bidder, the high bidder wins immediately.
export function affordableBidderCount(state, auction) {
  const next = nextMinBid(auction);
  let n = 0;
  for (const s of state.seats) {
    if (s.bankrupt) continue;
    if (s.cash >= next) n++;
  }
  return n;
}

export function applyBid(state, auction, seatIndex, amount, now = Date.now()) {
  const seat = state.seats[seatIndex];
  if (!seat || seat.bankrupt) return { ok: false, error: 'NOT_BIDDABLE' };
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return { ok: false, error: 'BID_TOO_LOW' };
  if (amount < nextMinBid(auction)) return { ok: false, error: 'BID_TOO_LOW' };
  if (seat.cash < amount) return { ok: false, error: 'INSUFFICIENT_FUNDS' };
  auction.currentBid = amount;
  auction.highBidder = seatIndex;
  auction.lastBidAtMs = now;
  auction.endsAtMs = now + AUCTION_DURATION_MS;
  return { ok: true };
}

export function shouldSettleEarly(state, auction) {
  return affordableBidderCount(state, auction) <= 1;
}

export function isExpired(auction, now = Date.now()) {
  return now >= auction.endsAtMs;
}

// Settle: deduct cash, assign ownership if there was a winner. No-op on no bids.
export function settle(state, auction) {
  if (auction.highBidder != null && auction.currentBid > 0) {
    const seat = state.seats[auction.highBidder];
    if (seat.cash < auction.currentBid) {
      return { soldTo: null, price: 0 };
    }
    seat.cash -= auction.currentBid;
    state.properties[auction.spaceIndex].ownerSeat = auction.highBidder;
    return { soldTo: auction.highBidder, price: auction.currentBid };
  }
  return { soldTo: null, price: 0 };
}
