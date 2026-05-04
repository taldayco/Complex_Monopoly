// Pure helpers for the stock market. Mutates the slice of state passed in;
// callers (the reducer) work on a structuredClone of the room.

import {
  STOCK_CATALOG,
  STOCK_ORDER,
  VOLATILE_STOCK_ORDER,
  FP500_SYMBOL,
  BASE_CARDS,
  STOCK_HISTORY_CAP
} from '../../shared/reserve/stockCatalog.js';

export function createStocksState() {
  const market = {};
  for (const sym of STOCK_ORDER) {
    const cat = STOCK_CATALOG[sym];
    market[sym] = {
      symbol: sym,
      price: cat.start,
      history: [cat.start],
      deck: [],
      lastCard: null,
      lastFlipPct: 0
    };
  }
  return {
    round: 0,
    cycle: 0,
    lastFlip: null,
    market
  };
}

export function hydrateStocks(stocks) {
  if (!stocks || typeof stocks !== 'object') return createStocksState();
  if (!stocks.market || typeof stocks.market !== 'object') {
    return createStocksState();
  }
  for (const sym of STOCK_ORDER) {
    const cat = STOCK_CATALOG[sym];
    if (!stocks.market[sym]) {
      stocks.market[sym] = {
        symbol: sym,
        price: cat.start,
        history: [cat.start],
        deck: [],
        lastCard: null,
        lastFlipPct: 0
      };
    } else {
      const m = stocks.market[sym];
      if (typeof m.price !== 'number') m.price = cat.start;
      if (!Array.isArray(m.history)) m.history = [m.price];
      if (!Array.isArray(m.deck)) m.deck = [];
      if (m.lastCard === undefined) m.lastCard = null;
      if (typeof m.lastFlipPct !== 'number') m.lastFlipPct = 0;
    }
  }
  if (typeof stocks.round !== 'number') stocks.round = 0;
  if (typeof stocks.cycle !== 'number') stocks.cycle = 0;
  if (stocks.lastFlip === undefined) stocks.lastFlip = null;
  return stocks;
}

// Fisher-Yates using an injected RNG (the reducer's deterministic seeded one).
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDeckFor(symbol, rng) {
  const cat = STOCK_CATALOG[symbol];
  if (!cat || cat.type !== 'volatile') return [];
  const cards = [
    ...BASE_CARDS.map((value) => ({ value, wild: false })),
    ...cat.wildCards.map((value) => ({ value, wild: true }))
  ];
  return shuffle(cards, rng);
}

function ensureDeck(stocks, symbol, rng) {
  const m = stocks.market[symbol];
  if (!m.deck || m.deck.length === 0) {
    m.deck = buildDeckFor(symbol, rng);
  }
}

function drawTopCard(stocks, symbol, rng) {
  ensureDeck(stocks, symbol, rng);
  const m = stocks.market[symbol];
  if (m.deck.length === 0) return null;
  return m.deck.shift();
}

function applyPercentToPrice(price, pct) {
  // Match the original: % change of the current price, with a $0.01 floor.
  const next = price * (1 + pct / 100);
  if (!Number.isFinite(next)) return price;
  return Math.max(0.01, Math.round(next * 100) / 100);
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
  fp.price = Math.max(0.01, Math.round(avg * 100) / 100);
}

// Flip the entire market: draw one card per volatile stock, apply, recompute
// the FP500 index. Returns a results map { [sym]: percentChange (or absolute
// price for FP500) } for logging/UI.
export function flipMarket(stocks, rng, now = Date.now()) {
  const results = {};
  for (const sym of VOLATILE_STOCK_ORDER) {
    const card = drawTopCard(stocks, sym, rng);
    if (!card) continue;
    const m = stocks.market[sym];
    m.lastCard = card.value;
    m.lastFlipPct = card.value;
    m.price = applyPercentToPrice(m.price, card.value);
    pushHistory(m);
    results[sym] = card.value;
  }
  recalcFP500(stocks);
  pushHistory(stocks.market[FP500_SYMBOL]);
  results[FP500_SYMBOL] = stocks.market[FP500_SYMBOL].price;
  stocks.round += 1;
  stocks.cycle += 1;
  stocks.lastFlip = { at: now, results };
  return results;
}

// Single-stock flip (banker action). Same draw logic but only one symbol.
export function flipSingleStock(stocks, symbol, rng, now = Date.now()) {
  if (!STOCK_CATALOG[symbol] || STOCK_CATALOG[symbol].type !== 'volatile') {
    return null;
  }
  const card = drawTopCard(stocks, symbol, rng);
  if (!card) return null;
  const m = stocks.market[symbol];
  m.lastCard = card.value;
  m.lastFlipPct = card.value;
  m.price = applyPercentToPrice(m.price, card.value);
  pushHistory(m);
  recalcFP500(stocks);
  pushHistory(stocks.market[FP500_SYMBOL]);
  stocks.lastFlip = {
    at: now,
    results: { [symbol]: card.value, [FP500_SYMBOL]: stocks.market[FP500_SYMBOL].price }
  };
  return card.value;
}

export function setStockPrice(stocks, symbol, newPrice) {
  if (!STOCK_CATALOG[symbol] || STOCK_CATALOG[symbol].type !== 'volatile') {
    return false;
  }
  const m = stocks.market[symbol];
  if (typeof newPrice !== 'number' || newPrice <= 0) return false;
  m.price = Math.round(newPrice * 100) / 100;
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
  const cost = Math.round(price * qty * 100) / 100;
  if (seat.cash < cost) return { ok: false, error: 'INSUFFICIENT_FUNDS' };

  seat.cash = Math.round((seat.cash - cost) * 100) / 100;
  seat.stockLots[symbol] = (seat.stockLots[symbol] || 0) + qty;
  seat.stockCostBasis[symbol] = Math.round(((seat.stockCostBasis[symbol] || 0) + cost) * 100) / 100;
  return { ok: true, qty, cost, price };
}

export function sellShares(seat, stocks, symbol, qty) {
  if (!STOCK_CATALOG[symbol]) return { ok: false, error: 'UNKNOWN_STOCK' };
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, error: 'BAD_QTY' };
  const owned = seat.stockLots[symbol] || 0;
  if (owned < qty) return { ok: false, error: 'INSUFFICIENT_SHARES' };

  const price = stocks.market[symbol]?.price ?? 0;
  const proceeds = Math.round(price * qty * 100) / 100;
  // Reduce cost basis proportionally so realised P&L tracks accurately.
  const basisShare = (seat.stockCostBasis[symbol] || 0) * (qty / owned);
  seat.cash = Math.round((seat.cash + proceeds) * 100) / 100;
  seat.stockLots[symbol] = owned - qty;
  seat.stockCostBasis[symbol] = Math.round(((seat.stockCostBasis[symbol] || 0) - basisShare) * 100) / 100;
  if (seat.stockLots[symbol] === 0) {
    seat.stockCostBasis[symbol] = 0;
  }
  return { ok: true, qty, proceeds, price };
}
