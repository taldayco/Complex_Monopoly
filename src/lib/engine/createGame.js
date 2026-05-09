import { BOARD } from '../shared/board.js';
import {
  STARTING_CASH,
  TOTAL_HOUSES,
  TOTAL_HOTELS,
  STARTING_CREDIT_SCORE,
  HYSA_BASE_RATE
} from '../shared/constants.js';
import { CHANCE_CARDS } from '../shared/chance.js';
import { COMMUNITY_CHEST_CARDS } from '../shared/communityChest.js';
import { isOwnable } from '../shared/board.js';
import { createStocksState, hydrateStocks } from './reserve/stocks.js';
import { createReserveDeckState, hydrateReserveDecks } from './reserve/eventCards.js';

export function createInitialRoom({ code, hostPlayerToken, rngSeed }) {
  return {
    code,
    phase: 'lobby',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    hostPlayerToken,
    rngSeed,
    rngCursor: 0,
    seats: [],
    properties: makeInitialProperties(),
    bank: { housesAvailable: TOTAL_HOUSES, hotelsAvailable: TOTAL_HOTELS },
    turn: {
      seat: 0,
      phase: 'preRoll',
      lastRoll: null,
      doublesCount: 0
    },
    pendingAction: null,
    pendingAuctions: [],
    pendingRequests: [],
    pendingTransfers: [],
    stocks: createStocksState(rngSeed),
    chance: { deck: shuffleIds(CHANCE_CARDS, rngSeed, 1), discard: [] },
    communityChest: { deck: shuffleIds(COMMUNITY_CHEST_CARDS, rngSeed, 2), discard: [] },
    reserveDecks: createReserveDeckState(rngSeed),
    finishedAt: null,
    winnerSeat: null,
    log: []
  };
}

export function newSeat({ seat, playerToken, name, tokenPiece }) {
  return {
    seat,
    playerToken,
    name,
    tokenPiece,
    connected: true,
    disconnectedAt: null,
    cash: STARTING_CASH,
    position: 0,
    inJail: false,
    jailTurns: 0,
    getOutOfJailFreeChance: false,
    getOutOfJailFreeCommunity: false,
    bankrupt: false,
    // Reserve fields
    baseScore: STARTING_CREDIT_SCORE,
    creditScore: STARTING_CREDIT_SCORE,
    loans: [],
    creditCards: [],
    stockLots: {},
    stockCostBasis: {},
    transactions: [],
    eventInventory: { getOutOfJailFree: 0, avoidJail: 0 },
    tempEffects: [],
    hysaRate: HYSA_BASE_RATE,
    loanTurnResponded: true,
    pendingLoanOffer: null,
    lastDrawnEventCard: null,
    drewEventCardThisTurn: false,
    revealedWildcards: {}
  };
}

// Backfill any reserve fields missing from a room loaded from disk that predates
// the reserve overlay. Idempotent — safe to call on already-hydrated rooms.
export function hydrateRoom(room) {
  if (!room || typeof room !== 'object') return room;
  delete room.bankerMode;
  if (!Array.isArray(room.pendingAuctions)) room.pendingAuctions = [];
  if (!Array.isArray(room.pendingRequests)) room.pendingRequests = [];
  if (!Array.isArray(room.pendingTransfers)) room.pendingTransfers = [];
  // A server crash mid Market Open leaves stale state and no timer to tick it
  // forward. Clear so the next landing can re-trigger cleanly.
  if (room.marketOpen !== undefined) room.marketOpen = null;
  room.stocks = hydrateStocks(room.stocks, room.rngSeed ?? 0);
  hydrateReserveDecks(room);
  if (Array.isArray(room.seats)) {
    for (const s of room.seats) hydrateSeat(s);
  }
  return room;
}

function hydrateSeat(s) {
  if (typeof s.baseScore !== 'number') s.baseScore = STARTING_CREDIT_SCORE;
  if (typeof s.creditScore !== 'number') s.creditScore = STARTING_CREDIT_SCORE;
  if (!Array.isArray(s.loans)) s.loans = [];
  if (!Array.isArray(s.creditCards)) s.creditCards = [];
  if (!s.stockLots || typeof s.stockLots !== 'object') s.stockLots = {};
  if (!s.stockCostBasis || typeof s.stockCostBasis !== 'object') s.stockCostBasis = {};
  if (!Array.isArray(s.transactions)) s.transactions = [];
  if (!s.eventInventory || typeof s.eventInventory !== 'object') {
    s.eventInventory = { getOutOfJailFree: 0, avoidJail: 0 };
  }
  if (!Array.isArray(s.tempEffects)) s.tempEffects = [];
  if (typeof s.hysaRate !== 'number') s.hysaRate = HYSA_BASE_RATE;
  if (typeof s.loanTurnResponded !== 'boolean') s.loanTurnResponded = true;
  if (s.pendingLoanOffer === undefined) s.pendingLoanOffer = null;
  if (s.lastDrawnEventCard === undefined) s.lastDrawnEventCard = null;
  if (typeof s.drewEventCardThisTurn !== 'boolean') s.drewEventCardThisTurn = false;
  if (!s.revealedWildcards || typeof s.revealedWildcards !== 'object') s.revealedWildcards = {};
}

function makeInitialProperties() {
  const props = {};
  for (const space of BOARD) {
    if (isOwnable(space)) {
      props[space.index] = { ownerSeat: null, mortgaged: false, houses: 0 };
    }
  }
  return props;
}

// Deterministic Fisher-Yates using a simple LCG so we don't need to inject the rng module here.
function shuffleIds(cards, seed, salt) {
  const ids = cards.map((c) => c.id);
  let s = (seed ^ (salt * 0x9e3779b1)) >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}
