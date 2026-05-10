import { reducer } from '../engine/reducer.js';
import { makeRng } from './rng.js';
import {
  getRoom,
  createRoom,
  joinRoom,
  leaveRoom,
  startGame,
  commitRoomState,
  setSeatConnection
} from './roomManager.js';
import { C2S, S2C } from '../shared/messageTypes.js';
import { scheduleAuctionEnd, cancelAuctionEnd, scheduleTimer, cancelTimer } from './auctionTimer.js';

// State for each connected socket: { roomCode, playerToken, seatIndex }
const socketState = new WeakMap();

// roomCode -> Set of WebSocket
const roomSockets = new Map();

export function handleMessage(socket, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return sendError(socket, 'BAD_JSON');
  }
  if (!msg || typeof msg.type !== 'string') return sendError(socket, 'BAD_MESSAGE');

  switch (msg.type) {
    case C2S.AUTH:          return handleAuth(socket, msg);
    case C2S.CREATE_ROOM:   return handleCreateRoom(socket, msg);
    case C2S.JOIN_ROOM:     return handleJoinRoom(socket, msg);
    case C2S.LEAVE_ROOM:    return handleLeaveRoom(socket, msg);
    case C2S.START_GAME:    return handleStartGame(socket, msg);
    case 'ping':            return handlePing(socket, msg);
    default:                return handleGameAction(socket, msg);
  }
}

function handlePing(socket, msg) {
  try {
    socket.send(JSON.stringify({ type: S2C.PING, t: msg?.t ?? Date.now() }));
  } catch {}
}

export function handleConnect(socket) {
  // Nothing until authentication.
}

export function handleDisconnect(socket) {
  const ss = socketState.get(socket);
  if (!ss) return;
  const room = getRoom(ss.roomCode);
  if (!room) {
    socketState.delete(socket);
    return;
  }
  removeSocketFromRoom(ss.roomCode, socket);
  socketState.delete(socket);
  // Only mark the seat disconnected if no other live socket holds the same
  // playerToken. A player with two open tabs should not trip "skip player"
  // eligibility just because one tab closed.
  if (!hasLiveSocketFor(ss.roomCode, ss.playerToken)) {
    setSeatConnection(ss.roomCode, ss.playerToken, false);
  }
  broadcastState(ss.roomCode);
}

function hasLiveSocketFor(roomCode, playerToken) {
  const set = roomSockets.get(roomCode);
  if (!set) return false;
  for (const s of set) {
    const meta = socketState.get(s);
    if (meta?.playerToken === playerToken) return true;
  }
  return false;
}

// ---- LOBBY HANDLERS ----

function handleCreateRoom(socket, msg) {
  const { room, seat } = createRoom({
    name: msg.name,
    tokenPiece: msg.tokenPiece
  });
  registerSocket(socket, room.code, seat.playerToken, seat.seat);
  sendWelcome(socket, room, seat);
  broadcastState(room.code);
}

function handleJoinRoom(socket, msg) {
  const result = joinRoom(msg.roomCode, {
    name: msg.name,
    tokenPiece: msg.tokenPiece
  });
  if (result.error) return sendError(socket, result.error);
  const { room, seat } = result;
  registerSocket(socket, room.code, seat.playerToken, seat.seat);
  sendWelcome(socket, room, seat);
  broadcastState(room.code);
}

function handleLeaveRoom(socket, msg) {
  const ss = socketState.get(socket);
  if (!ss) return sendError(socket, 'NOT_AUTHED');
  const result = leaveRoom(ss.roomCode, ss.playerToken);
  if (result.error) return sendError(socket, result.error);
  removeSocketFromRoom(ss.roomCode, socket);
  socketState.delete(socket);
  if (result.room) broadcastState(result.room.code);
}

function handleStartGame(socket, msg) {
  const ss = socketState.get(socket);
  if (!ss) return sendError(socket, 'NOT_AUTHED');
  // Defensively make sure the requester is in the room's broadcast Set.
  // Earlier auth/welcome broadcasts may have been pruned by overzealous
  // cleanup in older builds.
  if (!roomSockets.get(ss.roomCode)?.has(socket)) {
    if (!roomSockets.has(ss.roomCode)) roomSockets.set(ss.roomCode, new Set());
    roomSockets.get(ss.roomCode).add(socket);
  }
  const result = startGame(ss.roomCode, ss.playerToken);
  if (result.error) {
    sendError(socket, result.error);
    // Catch a stale client up: if the room has already started, the host's
    // UI is on the lobby because they missed an earlier broadcast. Push the
    // current state directly so they navigate forward instead of being stuck
    // hammering Start Game.
    if (result.error === 'ALREADY_STARTED') sendStateTo(socket, ss.roomCode);
    return;
  }
  // Belt-and-suspenders: send state directly to the requester first, then
  // broadcast to everyone (including them). The direct send guarantees the
  // host navigates even if the broadcast loop drops them for any reason.
  sendStateTo(socket, ss.roomCode);
  broadcastState(ss.roomCode);
}

function handleAuth(socket, msg) {
  // Reconnect: client sends roomCode + playerToken; server matches them up.
  const room = getRoom(msg.roomCode);
  if (!room) return sendError(socket, 'NO_ROOM');
  const seat = room.seats.find((s) => s.playerToken === msg.playerToken);
  if (!seat) return sendError(socket, 'NOT_IN_ROOM');
  registerSocket(socket, room.code, seat.playerToken, seat.seat);
  setSeatConnection(room.code, seat.playerToken, true);
  sendWelcome(socket, room, seat);
  broadcastState(room.code);
}

// ---- IN-GAME ACTION ----

async function handleGameAction(socket, msg) {
  const ss = socketState.get(socket);
  if (!ss) return sendError(socket, 'NOT_AUTHED');
  const room = getRoom(ss.roomCode);
  if (!room) return sendError(socket, 'NO_ROOM');

  const liveSeat = room.seats.find((s) => s.playerToken === ss.playerToken);
  if (!liveSeat) return sendError(socket, 'NOT_IN_ROOM');
  if (ss.seatIndex !== liveSeat.seat) ss.seatIndex = liveSeat.seat;
  const action = { ...msg, seat: liveSeat.seat };
  delete action._server;
  const rng = makeRng(room.rngSeed, room.rngCursor);
  const result = reducer(room, action, { rng });
  if (!result.ok) return sendError(socket, result.error);
  commitRoomState(ss.roomCode, result.state);
  await processEventsForTimers(ss.roomCode, result.events);
  broadcastState(ss.roomCode);
}

// Runs an action that originates inside the server (e.g. an auction-timer fire
// injecting `{ type: 'auctionTick', _server: true }`). Returns a promise that
// resolves once timer scheduling side-effects have settled — important for
// the DO alarm() handler so a re-armed alarm isn't immediately overwritten.
export async function runServerAction(roomCode, action) {
  const room = getRoom(roomCode);
  if (!room) return;
  const rng = makeRng(room.rngSeed, room.rngCursor);
  const result = reducer(room, action, { rng });
  if (!result.ok) {
    console.warn('runServerAction failed', action.type, result.error);
    return;
  }
  commitRoomState(roomCode, result.state);
  await processEventsForTimers(roomCode, result.events);
  broadcastState(roomCode);
}

async function processEventsForTimers(roomCode, events) {
  if (!events || events.length === 0) return;
  let auctionFinal;
  let marketFinal;
  for (const e of events) {
    if (e.type === 'auctionStart' && e.payload?.endsAtMs) {
      auctionFinal = e.payload.endsAtMs;
    } else if (e.type === 'bid' && e.payload?.endsAtMs) {
      auctionFinal = e.payload.endsAtMs;
    } else if (e.type === 'auctionEnd') {
      auctionFinal = null;
    } else if (e.type === 'marketOpenStart' && e.payload?.nextTickAtMs) {
      marketFinal = e.payload.nextTickAtMs;
    } else if (e.type === 'marketTickScheduled' && e.payload?.nextTickAtMs) {
      marketFinal = e.payload.nextTickAtMs;
    } else if (e.type === 'marketOpenEnd') {
      marketFinal = null;
    }
  }
  const writes = [];
  if (auctionFinal === null) writes.push(cancelAuctionEnd());
  else if (typeof auctionFinal === 'number') writes.push(scheduleAuctionEnd(roomCode, auctionFinal));
  if (marketFinal === null) writes.push(cancelTimer('market'));
  else if (typeof marketFinal === 'number') writes.push(scheduleTimer('market', roomCode, marketFinal));
  await Promise.all(writes);
}

// ---- BROADCAST ----

function broadcastState(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;
  const sockets = roomSockets.get(roomCode);
  if (!sockets) return;
  // Snapshot to a fresh array so a mid-iteration close() that mutates the
  // backing Set doesn't skip subsequent sockets. Try each send; log on
  // failure but DO NOT prune from the Set — a transient send error (e.g. a
  // momentarily-stalled buffer in workerd) shouldn't permanently sideline a
  // live socket. Real disconnects are cleaned up by handleDisconnect on the
  // close event.
  for (const s of [...sockets]) {
    const ss = socketState.get(s);
    const liveSeat = ss && room.seats.find((seat) => seat.playerToken === ss.playerToken);
    const viewerSeat = liveSeat?.seat ?? ss?.seatIndex ?? null;
    if (ss && liveSeat && ss.seatIndex !== liveSeat.seat) ss.seatIndex = liveSeat.seat;
    try {
      s.send(JSON.stringify({ type: S2C.STATE, gameState: scrubState(room, viewerSeat) }));
    } catch (e) {
      console.warn('broadcastState send failed', ss?.playerToken?.slice?.(0, 8), e?.message ?? e);
    }
  }
}

function sendWelcome(socket, room, seat) {
  socket.send(JSON.stringify({
    type: S2C.WELCOME,
    playerToken: seat.playerToken,
    seat: seat.seat,
    roomCode: room.code,
    gameState: scrubState(room, seat.seat)
  }));
}

// Push the current room state to a single socket. Used as a re-sync safety
// net when a client's action fails because it's stale (e.g. clicking Start
// Game when the room already started).
function sendStateTo(socket, roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;
  const ss = socketState.get(socket);
  const viewerSeat = ss?.seatIndex ?? null;
  try {
    socket.send(JSON.stringify({ type: S2C.STATE, gameState: scrubState(room, viewerSeat) }));
  } catch (e) {
    console.warn('sendStateTo failed', e?.message ?? e);
  }
}

function sendError(socket, code, message) {
  try {
    socket.send(JSON.stringify({ type: S2C.ERROR, code, message: message ?? code }));
  } catch (e) {
    console.warn('sendError failed', code, e?.message ?? e);
  }
}

// Strip per-seat secret playerToken from the broadcasted state. Each client
// receives only non-secret fields; their own token came in their welcome
// message. `viewerSeat` is the recipient's seat index — fields that are
// private to a seat (e.g. revealedWildcards from insider-tip chance cards) are
// only included on the matching seat and redacted from everyone else's view.
function scrubState(room, viewerSeat) {
  const hostSeat = room.seats.find((s) => s.playerToken === room.hostPlayerToken)?.seat ?? null;
  const { hostPlayerToken, rngSeed, rngCursor, reserveDecks, stocks, marketOpen, economy, ...rest } = room;
  return {
    ...rest,
    hostSeat,
    stocks: scrubStocks(stocks),
    economy: scrubEconomy(economy),
    marketOpen: scrubMarketOpen(marketOpen),
    reserveDecks: reserveDecks
      ? {
          community: {
            deckSize: reserveDecks.community?.deck?.length ?? 0,
            discardSize: reserveDecks.community?.discard?.length ?? 0
          },
          chance: {
            deckSize: reserveDecks.chance?.deck?.length ?? 0,
            discardSize: reserveDecks.chance?.discard?.length ?? 0
          }
        }
      : null,
    seats: room.seats.map((s) => {
      const isSelf = s.seat === viewerSeat;
      return {
        seat: s.seat,
        name: s.name,
        tokenPiece: s.tokenPiece,
        connected: s.connected,
        disconnectedAt: s.disconnectedAt,
        cash: s.cash,
        position: s.position,
        inJail: s.inJail,
        jailTurns: s.jailTurns,
        getOutOfJailFreeChance: s.getOutOfJailFreeChance,
        getOutOfJailFreeCommunity: s.getOutOfJailFreeCommunity,
        bankrupt: s.bankrupt,
        // Reserve fields — non-secret, all players see all players' finance state
        baseScore: s.baseScore,
        creditScore: s.creditScore,
        loans: s.loans,
        mortgageLoans: s.mortgageLoans ?? [],
        standardLoansThisTurn: s.standardLoansThisTurn ?? 0,
        creditCards: s.creditCards,
        stockLots: s.stockLots,
        stockCostBasis: s.stockCostBasis,
        transactions: s.transactions,
        eventInventory: s.eventInventory,
        tempEffects: s.tempEffects,
        loanTurnResponded: s.loanTurnResponded,
        mortgageTurnResponded: s.mortgageTurnResponded ?? true,
        nextDevModifier: s.nextDevModifier ?? null,
        nextPermitFeeModifier: s.nextPermitFeeModifier ?? null,
        pendingLoanOffer: s.pendingLoanOffer ?? null,
        bankAccounts: s.bankAccounts ?? null,
        // Private to the owning seat: revealed wildcard values from insider tips.
        revealedWildcards: isSelf ? (s.revealedWildcards ?? {}) : {}
      };
    }),
    chance: { deckSize: room.chance.deck.length, discardSize: room.chance.discard.length },
    communityChest: {
      deckSize: room.communityChest.deck.length,
      discardSize: room.communityChest.discard.length
    }
  };
}

// Strip the pre-rolled flip schedule from the broadcasted market-open state.
// Clients see counters/timestamps so the modal can render countdown + tick
// pacing, but never the future per-tick results (which would let them predict
// price moves before they happen).
function scrubMarketOpen(mo) {
  if (!mo || typeof mo !== 'object') return mo ?? null;
  const { scheduledFlips, ...rest } = mo;
  return rest;
}

// Strip per-stock card-deck contents so clients can't peek the order. Replace
// each stock's `deck: [{value, wild}, …]` with summary counts that the market
// monitor can render. Prices, history, and last-flip pcts pass through.
function scrubStocks(stocks) {
  if (!stocks || typeof stocks !== 'object') return stocks ?? null;
  const market = {};
  if (stocks.market && typeof stocks.market === 'object') {
    for (const [sym, m] of Object.entries(stocks.market)) {
      const deck = Array.isArray(m?.deck) ? m.deck : [];
      let wildsRemaining = 0;
      for (const c of deck) if (c && c.wild) wildsRemaining += 1;
      const { deck: _, ...rest } = m ?? {};
      market[sym] = {
        ...rest,
        deckSize: deck.length,
        wildsRemaining
      };
    }
  }
  return {
    round: stocks.round ?? 0,
    lastFlip: stocks.lastFlip ?? null,
    market
  };
}

function scrubEconomy(econ) {
  if (!econ || typeof econ !== 'object') return econ ?? null;
  const deck = Array.isArray(econ.deck) ? econ.deck : [];
  let wildsRemaining = 0;
  for (const c of deck) if (c && c.wild) wildsRemaining += 1;
  return {
    reserveRate: econ.reserveRate ?? 0,
    inflationFactor: econ.inflationFactor ?? 1,
    deckSize: deck.length,
    wildsRemaining,
    history: Array.isArray(econ.history) ? econ.history : [],
    lastFlip: econ.lastFlip ?? null,
    round: econ.round ?? 0
  };
}

// ---- SOCKET BOOKKEEPING ----

function registerSocket(socket, roomCode, playerToken, seatIndex) {
  // If this socket was previously registered to a different room (or seat),
  // pull it out of the old room's socket set first so broadcasts to the old
  // room don't keep targeting it.
  const prev = socketState.get(socket);
  if (prev && prev.roomCode !== roomCode) {
    removeSocketFromRoom(prev.roomCode, socket);
  }
  socketState.set(socket, { roomCode, playerToken, seatIndex });
  if (!roomSockets.has(roomCode)) roomSockets.set(roomCode, new Set());
  roomSockets.get(roomCode).add(socket);
}

function removeSocketFromRoom(roomCode, socket) {
  const set = roomSockets.get(roomCode);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) roomSockets.delete(roomCode);
}
