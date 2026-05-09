// Market Open: triggered when a player lands on tile 4, 20, or 38. For 34
// seconds, every volatile stock draws one card per second from its movement
// deck, applying the % change live. Players can buy and sell from the Market
// Monitor during the window. Auctions, end-of-turn, and rolling are blocked
// until the window closes.
//
// Determinism: the entire 34-tick sequence is pre-rolled at start using the
// reducer's seeded RNG and stored on `state.marketOpen.scheduledFlips`. Each
// `marketOpenTick` is pure presentation — it copies the next pre-rolled
// snapshot onto the live stocks slice. RNG consumption happens once at start
// (one bump of `state.rngCursor` per pre-rolled flip, matching the convention
// of the existing auto-flip path), so wall-clock jitter on tick delivery
// cannot desync the seeded stream.

import { flipMarket } from './stocks.js';
import { STOCK_HISTORY_CAP } from '../../shared/reserve/stockCatalog.js';

export const MARKET_OPEN_TOTAL_TICKS = 34;
export const MARKET_OPEN_TICK_INTERVAL_MS = 1000;

// Pre-roll `totalTicks` market flips on a deep-cloned stocks slice so the live
// state is untouched. Each captured frame carries the per-stock pct change,
// the post-tick price, and the post-tick deck contents — enough to advance the
// live state on each tick without any further RNG draws.
function precomputeFlips(stocks, rng, totalTicks) {
  const shadow = structuredClone(stocks);
  const frames = [];
  for (let i = 0; i < totalTicks; i++) {
    const results = flipMarket(shadow, rng);
    const pricesAfter = {};
    const decksAfter = {};
    for (const sym of Object.keys(shadow.market)) {
      pricesAfter[sym] = shadow.market[sym].price;
      const d = shadow.market[sym].deck;
      if (Array.isArray(d)) decksAfter[sym] = d.slice();
    }
    // `__reshuffled` is non-enumerable on `results` so it survives spread but
    // must be lifted onto a normal field for snapshots.
    const reshuffled = results.__reshuffled ?? [];
    frames.push({ results, pricesAfter, decksAfter, reshuffled });
  }
  return frames;
}

export function startMarketOpen(state, seatIndex, ctx, spaceIndex) {
  const startedAtMs = Date.now();
  const frames = precomputeFlips(state.stocks, ctx.rng, MARKET_OPEN_TOTAL_TICKS);
  // Bump the cursor once per pre-rolled flip so replays stay in sync with
  // the existing auto-flip convention (`flipMarket` is one cursor unit).
  state.rngCursor += MARKET_OPEN_TOTAL_TICKS;
  state.marketOpen = {
    active: true,
    totalTicks: MARKET_OPEN_TOTAL_TICKS,
    ticksFired: 0,
    startedAtMs,
    endsAtMs: startedAtMs + MARKET_OPEN_TOTAL_TICKS * MARKET_OPEN_TICK_INTERVAL_MS,
    nextTickAtMs: startedAtMs + MARKET_OPEN_TICK_INTERVAL_MS,
    triggerSeat: seatIndex,
    triggerSpaceIndex: spaceIndex,
    scheduledFlips: frames
  };
  return state.marketOpen;
}

// Apply the next pre-rolled flip frame to the live stocks slice. Returns
// { done, results, nextTickAtMs? } so the reducer can emit the right log
// events and (re)arm the timer.
export function applyMarketOpenTick(state, now = Date.now()) {
  const mo = state.marketOpen;
  if (!mo || !mo.active) return { done: true, error: 'INACTIVE' };
  const frame = mo.scheduledFlips?.[mo.ticksFired];
  if (!frame) {
    // No frame to apply — close out cleanly.
    state.marketOpen = null;
    return { done: true };
  }

  for (const [sym, m] of Object.entries(state.stocks.market)) {
    if (frame.pricesAfter[sym] != null) {
      m.price = frame.pricesAfter[sym];
      if (!Array.isArray(m.history)) m.history = [];
      m.history.push(m.price);
      if (m.history.length > STOCK_HISTORY_CAP) {
        m.history.splice(0, m.history.length - STOCK_HISTORY_CAP);
      }
    }
    if (frame.decksAfter[sym] != null) {
      m.deck = frame.decksAfter[sym];
    }
    if (typeof frame.results[sym] === 'number') {
      m.lastCard = frame.results[sym];
      m.lastFlipPct = frame.results[sym];
    }
  }
  // Reshuffles invalidate prior insider-tip wildcard reveals on those stocks.
  if (Array.isArray(frame.reshuffled) && frame.reshuffled.length > 0 && Array.isArray(state.seats)) {
    for (const sym of frame.reshuffled) {
      for (const s of state.seats) {
        if (s?.revealedWildcards && s.revealedWildcards[sym] !== undefined) {
          delete s.revealedWildcards[sym];
        }
      }
    }
  }
  state.stocks.round = (state.stocks.round ?? 0) + 1;
  state.stocks.cycle = (state.stocks.cycle ?? 0) + 1;
  state.stocks.lastFlip = { at: now, results: frame.results };

  mo.ticksFired += 1;
  if (mo.ticksFired >= mo.totalTicks) {
    state.marketOpen = null;
    return { done: true, results: frame.results, reshuffled: frame.reshuffled };
  }
  mo.nextTickAtMs = mo.startedAtMs + (mo.ticksFired + 1) * MARKET_OPEN_TICK_INTERVAL_MS;
  return { done: false, results: frame.results, nextTickAtMs: mo.nextTickAtMs, reshuffled: frame.reshuffled };
}

// Action types that remain allowed while a Market Open window is active.
// Buying/selling stocks is the whole point. Trades are allowed because
// other players might want to swap during the window. Server-injected
// market-open ticks must obviously pass through.
export const MARKET_OPEN_ALLOWED_ACTIONS = new Set([
  'buyStock',
  'sellStock',
  'proposeTrade',
  'respondTrade',
  'cancelTrade',
  'marketOpenTick'
]);
