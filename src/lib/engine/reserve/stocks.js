import { cents } from '../../shared/money.js';
// Pure helpers for the stock market. Mutates the slice of state passed in;
// callers (the reducer) work on a structuredClone of the room.

import {
  STOCK_CATALOG,
  STOCK_ORDER,
  VOLATILE_STOCK_ORDER,
  FP500_SYMBOL,
  BASE_CARDS,
  WILDCARD_POOL,
  STOCK_HISTORY_CAP
} from '../../shared/reserve/stockCatalog.js';
import { seededRng, shuffleInPlace } from '../../shared/rng/seeded.js';

export function createStocksState(rngSeed = 0, { primeHistory = true } = {}) {
  const market = {};
  for (const sym of STOCK_ORDER) {
    const cat = STOCK_CATALOG[sym];
    market[sym] = {
      symbol: sym,
      // startPrice anchors the additive-percent math in applyPercentToPrice.
      // Each card moves price by (startPrice × pct/100) — so a 32-card deck
      // summing to +15 always returns the stock to start × 1.15 (modulo
      // wildcards), regardless of compounding. Without this anchor, a single
      // -100 card would multiply the price by 0 and floor it at $0.01 forever.
      startPrice: cat.start,
      price: cat.start,
      history: [cat.start],
      deck: cat.type === 'volatile' ? buildDeckSeeded(sym, rngSeed) : [],
      lastCard: null,
      lastFlipPct: 0
    };
  }
  const stocks = {
    round: 0,
    lastFlip: null,
    market
  };
  if (primeHistory) primeStockHistory(stocks);
  return stocks;
}

export function hydrateStocks(stocks, rngSeed = 0) {
  if (!stocks || typeof stocks !== 'object') return createStocksState(rngSeed);
  if (!stocks.market || typeof stocks.market !== 'object') {
    return createStocksState(rngSeed);
  }
  for (const sym of STOCK_ORDER) {
    const cat = STOCK_CATALOG[sym];
    if (!stocks.market[sym]) {
      stocks.market[sym] = {
        symbol: sym,
        startPrice: cat.start,
        price: cat.start,
        history: [cat.start],
        deck: cat.type === 'volatile' ? buildDeckSeeded(sym, rngSeed) : [],
        lastCard: null,
        lastFlipPct: 0
      };
    } else {
      const m = stocks.market[sym];
      if (typeof m.startPrice !== 'number') m.startPrice = cat.start;
      if (typeof m.price !== 'number') m.price = cat.start;
      if (!Array.isArray(m.history)) m.history = [m.price];
      if (!Array.isArray(m.deck)) m.deck = [];
      // Backfill empty deck for pre-existing volatile stocks so the wildcards
      // are visible immediately (rather than only after the first flip rebuild).
      if (m.deck.length === 0 && cat.type === 'volatile') {
        m.deck = buildDeckSeeded(sym, rngSeed);
      }
      if (m.lastCard === undefined) m.lastCard = null;
      if (typeof m.lastFlipPct !== 'number') m.lastFlipPct = 0;
    }
  }
  if (typeof stocks.round !== 'number') stocks.round = 0;
  if (stocks.lastFlip === undefined) stocks.lastFlip = null;
  delete stocks.cycle;
  return stocks;
}

function buildDeckFor(symbol, rng) {
  const cat = STOCK_CATALOG[symbol];
  if (!cat || cat.type !== 'volatile') return [];
  const wilds = pickRandomWildcards(rng);
  const cards = [
    ...BASE_CARDS.map((value) => ({ value, wild: false })),
    ...wilds.map((value) => ({ value, wild: true }))
  ];
  return shuffleInPlace(cards, rng);
}

// Pick two wildcard values uniformly at random from WILDCARD_POOL with
// replacement (so duplicates like [-100, -100] are possible). Uses the
// supplied rng so determinism is preserved end-to-end.
function pickRandomWildcards(rng) {
  const n = WILDCARD_POOL.length;
  return [
    WILDCARD_POOL[Math.floor(rng() * n)],
    WILDCARD_POOL[Math.floor(rng() * n)]
  ];
}

// Build a stock's deck deterministically from rngSeed alone — used at room
// creation and on hydrate, when no live RNG is available. The per-symbol salt
// keeps each stock's order independent of the others.
function buildDeckSeeded(symbol, rngSeed) {
  const cat = STOCK_CATALOG[symbol];
  if (!cat || cat.type !== 'volatile') return [];
  const salt = 11 + STOCK_ORDER.indexOf(symbol);
  return buildDeckFor(symbol, seededRng(rngSeed, salt));
}

// Run a full deck-pass at game creation: drain every volatile stock's initial
// deck (BASE_CARDS + 2 wildcards = 34 cards) tick-by-tick, applying each card
// to its stock's price and recomputing FP500 each tick. Result: every lobby
// gets unique starting prices and a 34-tick price history that gives stocks
// "character" before the first market open.
//
// Does NOT touch round/cycle/lastFlip — those are gameplay counters tracked by
// real flips. The decks end empty; the next reshuffle will mint new random
// wildcards via the standard ensureDeck path.
export function primeStockHistory(stocks) {
  // Each volatile deck has exactly BASE_CARDS.length + 2 cards; one full pass
  // empties them all simultaneously. Read length from the first deck rather
  // than hard-coding 34 in case BASE_CARDS ever changes.
  const firstDeck = stocks.market[VOLATILE_STOCK_ORDER[0]]?.deck;
  const ticks = Array.isArray(firstDeck) ? firstDeck.length : 0;
  if (ticks === 0) return;
  for (let t = 0; t < ticks; t++) {
    for (const sym of VOLATILE_STOCK_ORDER) {
      const m = stocks.market[sym];
      if (!m.deck || m.deck.length === 0) continue;
      const card = m.deck.shift();
      m.lastCard = card.value;
      m.lastFlipPct = card.value;
      m.price = applyPercentToPrice(m.startPrice, m.price, card.value);
      pushHistory(m);
    }
    recalcFP500(stocks);
    pushHistory(stocks.market[FP500_SYMBOL]);
  }
}

// Returns true iff a fresh deck was just built (i.e. the deck was empty and
// is now repopulated with new random wildcards). Callers use this to detect
// reshuffles so they can invalidate stale wildcard reveals.
function ensureDeck(stocks, symbol, rng) {
  const m = stocks.market[symbol];
  if (!m.deck || m.deck.length === 0) {
    m.deck = buildDeckFor(symbol, rng);
    return true;
  }
  return false;
}

// Returns { card, reshuffled }. `reshuffled` is true when the deck had to be
// rebuilt before this draw — meaning the prior wildcards just rotated out and
// any insider-tip reveals on the old wildcards are now stale.
function drawTopCard(stocks, symbol, rng) {
  const reshuffled = ensureDeck(stocks, symbol, rng);
  const m = stocks.market[symbol];
  if (m.deck.length === 0) return { card: null, reshuffled };
  return { card: m.deck.shift(), reshuffled };
}

// Additive-against-start percent: each card moves the price by an absolute
// dollar amount of (startPrice × pct/100). After applying every card in the
// deck, the price equals startPrice × (1 + sum_of_pcts/100), independent of
// order or compounding. Floors at $0.01 so a wildcard run can hammer a stock
// to ~zero but a positive card always recovers it (vs the old multiplicative
// math, where one -100 card crashed the price to $0.01 forever).
function applyPercentToPrice(startPrice, currentPrice, pct) {
  const next = currentPrice + (startPrice * pct) / 100;
  if (!Number.isFinite(next)) return currentPrice;
  return Math.max(0.01, cents(next));
}

function pushHistory(market) {
  market.history.push(market.price);
  if (market.history.length > STOCK_HISTORY_CAP) {
    market.history.splice(0, market.history.length - STOCK_HISTORY_CAP);
  }
}

export function recalcFP500(stocks) {
  const fp = stocks.market[FP500_SYMBOL];
  if (!fp) return;
  const prices = VOLATILE_STOCK_ORDER
    .map((s) => stocks.market[s]?.price)
    .filter((p) => typeof p === 'number');
  if (prices.length === 0) return;
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  fp.price = Math.max(0.01, cents(avg));
}

// Flip the entire market: draw one card per volatile stock, apply, recompute
// the FP500 index. Returns a results map { [sym]: percentChange (or absolute
// price for FP500) } for logging/UI. The `reshuffled` array on the result
// lists symbols whose decks were rebuilt (with new random wildcards) during
// this flip — callers should clear stale wildcard reveals for those symbols.
export function flipMarket(stocks, rng, now = Date.now()) {
  const results = {};
  const reshuffled = [];
  for (const sym of VOLATILE_STOCK_ORDER) {
    const { card, reshuffled: didReshuffle } = drawTopCard(stocks, sym, rng);
    if (didReshuffle) reshuffled.push(sym);
    if (!card) continue;
    const m = stocks.market[sym];
    m.lastCard = card.value;
    m.lastFlipPct = card.value;
    m.price = applyPercentToPrice(m.startPrice, m.price, card.value);
    pushHistory(m);
    results[sym] = card.value;
  }
  recalcFP500(stocks);
  pushHistory(stocks.market[FP500_SYMBOL]);
  results[FP500_SYMBOL] = stocks.market[FP500_SYMBOL].price;
  stocks.round += 1;
  stocks.lastFlip = { at: now, results };
  Object.defineProperty(results, '__reshuffled', {
    value: reshuffled,
    enumerable: false
  });
  return results;
}

// Single-stock flip (banker action). Same draw logic but only one symbol.
// Returns { value, reshuffled } so callers can clear stale wildcard reveals.
export function flipSingleStock(stocks, symbol, rng, now = Date.now()) {
  if (!STOCK_CATALOG[symbol] || STOCK_CATALOG[symbol].type !== 'volatile') {
    return null;
  }
  const { card, reshuffled } = drawTopCard(stocks, symbol, rng);
  if (!card) return null;
  const m = stocks.market[symbol];
  m.lastCard = card.value;
  m.lastFlipPct = card.value;
  m.price = applyPercentToPrice(m.startPrice, m.price, card.value);
  pushHistory(m);
  recalcFP500(stocks);
  pushHistory(stocks.market[FP500_SYMBOL]);
  stocks.lastFlip = {
    at: now,
    results: { [symbol]: card.value, [FP500_SYMBOL]: stocks.market[FP500_SYMBOL].price }
  };
  return { value: card.value, reshuffled: reshuffled ? [symbol] : [] };
}

export function setStockPrice(stocks, symbol, newPrice) {
  if (!STOCK_CATALOG[symbol] || STOCK_CATALOG[symbol].type !== 'volatile') {
    return false;
  }
  const m = stocks.market[symbol];
  if (typeof newPrice !== 'number' || newPrice <= 0) return false;
  m.price = cents(newPrice);
  pushHistory(m);
  recalcFP500(stocks);
  pushHistory(stocks.market[FP500_SYMBOL]);
  return true;
}

// Buy/sell — operate on a seat. Returns { ok, error?, cost/proceeds, qty }.
export function buyShares(seat, stocks, symbol, qty) {
  if (!STOCK_CATALOG[symbol]) return { ok: false, error: 'UNKNOWN_STOCK' };
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, error: 'BAD_QTY' };
  const price = stocks.market[symbol]?.price ?? 0;
  const cost = cents(price * qty);
  if (seat.cash < cost) return { ok: false, error: 'INSUFFICIENT_FUNDS' };

  seat.cash = cents(seat.cash - cost);
  seat.stockLots[symbol] = (seat.stockLots[symbol] || 0) + qty;
  seat.stockCostBasis[symbol] = cents((seat.stockCostBasis[symbol] || 0) + cost);
  return { ok: true, qty, cost, price };
}

export function sellShares(seat, stocks, symbol, qty) {
  if (!STOCK_CATALOG[symbol]) return { ok: false, error: 'UNKNOWN_STOCK' };
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, error: 'BAD_QTY' };
  const owned = seat.stockLots[symbol] || 0;
  if (owned < qty) return { ok: false, error: 'INSUFFICIENT_SHARES' };

  const price = stocks.market[symbol]?.price ?? 0;
  const proceeds = cents(price * qty);
  // Reduce cost basis proportionally so realised P&L tracks accurately.
  const basisShare = (seat.stockCostBasis[symbol] || 0) * (qty / owned);
  seat.cash = cents(seat.cash + proceeds);
  seat.stockLots[symbol] = owned - qty;
  seat.stockCostBasis[symbol] = cents((seat.stockCostBasis[symbol] || 0) - basisShare);
  if (seat.stockLots[symbol] === 0) {
    seat.stockCostBasis[symbol] = 0;
  }
  return { ok: true, qty, proceeds, price };
}
