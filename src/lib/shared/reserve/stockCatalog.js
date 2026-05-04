// Stock catalog ported from monopoly-reserve. Five volatile stocks priced via
// shuffled card decks; one F&P500 index that tracks the average price of the
// volatile stocks.
//
// Each volatile stock starts with the same `BASE_CARDS` distribution (32 cards
// totalling +0 percent in expectation) plus two stock-specific `wildCards`
// that shift its long-run drift. Wild cards are mixed into the deck on each
// reshuffle.

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

// Per-stock characteristics (starting price, shares outstanding, wild cards).
// `wildCards` are the long-run-bias cards that get mixed into the deck on
// each reshuffle alongside the standard BASE_CARDS distribution.
export const STOCK_CATALOG = {
  TPHT: {
    symbol: 'TPHT',
    name: 'TPHT',
    type: 'volatile',
    start: 50,
    sharesOutstanding: 1000,
    wildCards: [-100, -100]
  },
  MNCL: {
    symbol: 'MNCL',
    name: 'MNCL',
    type: 'volatile',
    start: 20,
    sharesOutstanding: 1000,
    wildCards: [-50, 100]
  },
  CANE: {
    symbol: 'CANE',
    name: 'CANE',
    type: 'volatile',
    start: 75,
    sharesOutstanding: 1000,
    wildCards: [-25, 25]
  },
  RRRD: {
    symbol: 'RRRD',
    name: 'RRRD',
    type: 'volatile',
    start: 40,
    sharesOutstanding: 1000,
    wildCards: [-25, -100]
  },
  BORR: {
    symbol: 'BORR',
    name: 'BORR',
    type: 'volatile',
    start: 35,
    sharesOutstanding: 1000,
    wildCards: [25, 50]
  },
  [FP500_SYMBOL]: {
    symbol: FP500_SYMBOL,
    name: 'F&P500',
    type: 'index',
    // The index price is computed from the volatile stocks (see
    // `recalcFP500` in src/lib/engine/reserve/stocks.js); `start` is just
    // the seed value before any flips.
    start: 100
  }
};

// Cap on how many price points to retain per stock for charting.
export const STOCK_HISTORY_CAP = 100;

// In auto-banker rooms the market flips automatically after this many
// completed turns (counted across all seats).
export const AUTO_FLIP_EVERY_N_TURNS = 4;
