// Stock catalog. Five volatile stocks priced via shuffled card decks; one
// F&P500 index that tracks the average price of the volatile stocks.
//
// Each volatile stock's deck is the same `BASE_CARDS` distribution (32 cards,
// expected value 0%) plus two wildcards drawn at random from `WILDCARD_POOL`
// on every (re)shuffle.

export const VOLATILE_STOCK_ORDER = ['TPHT', 'MNCL', 'CANE', 'RRRD', 'BORR'];
export const FP500_SYMBOL = 'FP500';
export const STOCK_ORDER = [...VOLATILE_STOCK_ORDER, FP500_SYMBOL];

// Reference distribution shared by every volatile stock.
// Symmetric ±5/±10 with smaller wings; 32 cards, expected value 0.
export const BASE_CARDS = [
  5, 5, 5, 5, 5, 5,
  -5, -5, -5, -5, -5,
  10, 10, 10, 10, 10, 10,
  -10, -10, -10, -10, -10,
  25, 25, -25, -25,
  50, 50, -50, -50,
  100, -100
];

// Pool of possible wildcard values. On each (re)shuffle of a volatile stock's
// deck, two wildcards are picked at random (with replacement) from this pool
// and mixed into the 32 base cards.
export const WILDCARD_POOL = [-100, -50, -25, 25, 50, 100];

export const STOCK_CATALOG = {
  TPHT: { symbol: 'TPHT', name: 'TPHT', type: 'volatile', start: 50, sharesOutstanding: 1000 },
  MNCL: { symbol: 'MNCL', name: 'MNCL', type: 'volatile', start: 20, sharesOutstanding: 1000 },
  CANE: { symbol: 'CANE', name: 'CANE', type: 'volatile', start: 75, sharesOutstanding: 1000 },
  RRRD: { symbol: 'RRRD', name: 'RRRD', type: 'volatile', start: 40, sharesOutstanding: 1000 },
  BORR: { symbol: 'BORR', name: 'BORR', type: 'volatile', start: 35, sharesOutstanding: 1000 },
  // The index price is computed from the volatile stocks (see
  // `recalcFP500` in src/lib/engine/reserve/stocks.js); `start` is just
  // the seed value before any flips.
  [FP500_SYMBOL]: { symbol: FP500_SYMBOL, name: 'F&P500', type: 'index', start: 100 }
};

// Cap on how many price points to retain per stock for charting.
export const STOCK_HISTORY_CAP = 100;
