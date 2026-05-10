import { BOARD } from '../shared/board.js';
import {
  STARTING_CASH,
  TOTAL_HOUSES,
  TOTAL_HOTELS,
  STARTING_CREDIT_SCORE
} from '../shared/constants.js';
import { CHANCE_CARDS } from '../shared/chance.js';
import { COMMUNITY_CHEST_CARDS } from '../shared/communityChest.js';
import { isOwnable } from '../shared/board.js';
import { createStocksState, hydrateStocks } from './reserve/stocks.js';
import { createReserveDeckState, hydrateReserveDecks } from './reserve/eventCards.js';
import { createEconomyState, hydrateEconomy } from './reserve/economy.js';
import { ensureSeatBankAccounts } from './reserve/banking.js';

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
      lastRollWasDoubles: false,
      doublesCount: 0
    },
    pendingAction: null,
    pendingAuctions: [],
    pendingRequests: [],
    pendingTransfers: [],
    pendingJailSeizureChoice: null,
    pendingTrainTravel: null,
    pendingCardChoice: null,
    rollOff: null,
    turnCount: 0,
    economy: createEconomyState(rngSeed),
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
    baseScore: STARTING_CREDIT_SCORE,
    creditScore: STARTING_CREDIT_SCORE,
    loans: [],
    mortgageLoans: [],
    standardLoansThisTurn: 0,
    creditCards: [],
    stockLots: {},
    stockCostBasis: {},
    transactions: [],
    eventInventory: { getOutOfJailFree: 0, avoidJail: 0 },
    tempEffects: [],
    loanTurnResponded: true,
    mortgageTurnResponded: true,
    pendingLoanOffer: null,
    revealedWildcards: {},
    bankAccounts: {
      mmcu: { open: false, balance: 0, openedAt: 0 },
      boardwalk: { open: false, balance: 0, openedAt: 0 }
    }
  };
}

export function hydrateRoom(room) {
  if (!room || typeof room !== 'object') return room;
  delete room.bankerMode;
  if (!Array.isArray(room.pendingAuctions)) room.pendingAuctions = [];
  if (!Array.isArray(room.pendingRequests)) room.pendingRequests = [];
  if (!Array.isArray(room.pendingTransfers)) room.pendingTransfers = [];
  if (room.marketOpen !== undefined) room.marketOpen = null;
  room.stocks = hydrateStocks(room.stocks, room.rngSeed ?? 0);
  room.economy = hydrateEconomy(room.economy, room.rngSeed ?? 0);
  if (typeof room.turnCount !== 'number') room.turnCount = 0;
  hydrateReserveDecks(room);
  if (Array.isArray(room.seats)) {
    for (const s of room.seats) hydrateSeat(s);
    for (const s of room.seats) {
      if (Array.isArray(s.loans)) {
        for (const l of s.loans) {
          if (l && typeof l === 'object' && !l.bank) l.bank = 'mmcu';
        }
      }
    }
  }
  return room;
}

function hydrateSeat(s) {
  if (typeof s.baseScore !== 'number') s.baseScore = STARTING_CREDIT_SCORE;
  if (typeof s.creditScore !== 'number') s.creditScore = STARTING_CREDIT_SCORE;
  if (!Array.isArray(s.loans)) s.loans = [];
  if (!Array.isArray(s.mortgageLoans)) s.mortgageLoans = [];
  if (typeof s.standardLoansThisTurn !== 'number') s.standardLoansThisTurn = 0;
  if (!Array.isArray(s.creditCards)) s.creditCards = [];
  for (const c of s.creditCards) {
    if (typeof c.balance !== 'number') c.balance = 0;
    if (typeof c.openedAtTurn !== 'number') c.openedAtTurn = 0;
    if (typeof c.autopay !== 'boolean') c.autopay = true;
  }
  if (!s.stockLots || typeof s.stockLots !== 'object') s.stockLots = {};
  if (!s.stockCostBasis || typeof s.stockCostBasis !== 'object') s.stockCostBasis = {};
  if (!Array.isArray(s.transactions)) s.transactions = [];
  if (!s.eventInventory || typeof s.eventInventory !== 'object') {
    s.eventInventory = { getOutOfJailFree: 0, avoidJail: 0 };
  }
  if (!Array.isArray(s.tempEffects)) s.tempEffects = [];
  if (typeof s.loanTurnResponded !== 'boolean') s.loanTurnResponded = true;
  if (typeof s.mortgageTurnResponded !== 'boolean') s.mortgageTurnResponded = true;
  if (s.pendingLoanOffer === undefined) s.pendingLoanOffer = null;
  if (!s.revealedWildcards || typeof s.revealedWildcards !== 'object') s.revealedWildcards = {};
  delete s.hysaRate;
  ensureSeatBankAccounts(s);
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
