import { AUCTION_INCREMENT, AUCTION_DURATION_MS } from '../shared/constants.js';
import { BOARD } from '../shared/board.js';

export const AUCTION_ATTEMPT_FRACTIONS = [0.5, 0.25, 0];

export function startPriceForAttempt(spaceIndex, attempt) {
  const space = BOARD[spaceIndex];
  const price = space?.price ?? 0;
  const fraction = AUCTION_ATTEMPT_FRACTIONS[Math.max(0, Math.min(AUCTION_ATTEMPT_FRACTIONS.length - 1, attempt))];
  return Math.round(price * fraction * 100) / 100;
}

export function createAuction(spaceIndex, attempt = 0, now = Date.now()) {
  const startPrice = startPriceForAttempt(spaceIndex, attempt);
  return {
    type: 'auction',
    spaceIndex,
    attempt,
    startPrice,
    currentBid: 0,
    highBidder: null,
    endsAtMs: now + AUCTION_DURATION_MS,
    lastBidAtMs: null
  };
}

export function nextMinBid(auction) {
  if (auction.currentBid <= 0) return Math.max(0, auction.startPrice);
  return auction.currentBid + AUCTION_INCREMENT;
}

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
  if (auction.currentBid === 0) return false;
  return affordableBidderCount(state, auction) <= 1;
}

export function isExpired(auction, now = Date.now()) {
  return now >= auction.endsAtMs;
}

export function settle(state, auction) {
  if (auction.highBidder != null && auction.currentBid > 0) {
    const seat = state.seats[auction.highBidder];
    if (seat.cash < auction.currentBid) {
      return { soldTo: null, price: 0, settled: true };
    }
    seat.cash -= auction.currentBid;
    state.properties[auction.spaceIndex].ownerSeat = auction.highBidder;
    return { soldTo: auction.highBidder, price: auction.currentBid, settled: true };
  }
  return { soldTo: null, price: 0, settled: false };
}

export function pickRandomNonBankruptSeat(state, rng) {
  const eligible = state.seats.filter((s) => !s.bankrupt);
  if (eligible.length === 0) return null;
  const idx = Math.floor((rng?.() ?? 0) * eligible.length);
  return eligible[Math.min(idx, eligible.length - 1)].seat;
}

export function randomAssign(state, spaceIndex, rng) {
  const winnerSeat = pickRandomNonBankruptSeat(state, rng);
  if (winnerSeat == null) return { soldTo: null, price: 0 };
  state.properties[spaceIndex].ownerSeat = winnerSeat;
  return { soldTo: winnerSeat, price: 0, randomized: true };
}
