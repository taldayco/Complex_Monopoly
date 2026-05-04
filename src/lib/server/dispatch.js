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
import { scheduleAuctionEnd, cancelAuctionEnd } from './auctionTimer.js';

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
    default:                return handleGameAction(socket, msg);
  }
}

export function handleConnect(socket) {
  // Nothing until authentication.
}

export function handleDisconnect(socket) {
  const ss = socketState.get(socket);
  if (!ss) return;
  const room = getRoom(ss.roomCode);
  if (!room) return;
  setSeatConnection(ss.roomCode, ss.playerToken, false);
  removeSocketFromRoom(ss.roomCode, socket);
  broadcastState(ss.roomCode);
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
  const result = startGame(ss.roomCode, ss.playerToken);
  if (result.error) return sendError(socket, result.error);
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

function handleGameAction(socket, msg) {
  const ss = socketState.get(socket);
  if (!ss) return sendError(socket, 'NOT_AUTHED');
  const room = getRoom(ss.roomCode);
  if (!room) return sendError(socket, 'NO_ROOM');

  // Always derive seat index from the authenticated socket, not the client message.
  // Strip any client-supplied `_server` flag so internal-only actions (e.g.
  // 'auctionTick') can never be invoked by a remote.
  const action = { ...msg, seat: ss.seatIndex };
  delete action._server;
  const rng = makeRng(room.rngSeed, room.rngCursor);
  const result = reducer(room, action, { rng });
  if (!result.ok) return sendError(socket, result.error);
  commitRoomState(ss.roomCode, result.state);
  processEventsForTimers(ss.roomCode, result.events);
  broadcastState(ss.roomCode);
}

// Runs an action that originates inside the server (e.g. an auction-timer fire
// injecting `{ type: 'auctionTick', _server: true }`). Bypasses the socket
// auth/seat derivation and reuses the standard reducer + commit + broadcast.
export function runServerAction(roomCode, action) {
  const room = getRoom(roomCode);
  if (!room) return;
  const rng = makeRng(room.rngSeed, room.rngCursor);
  const result = reducer(room, action, { rng });
  if (!result.ok) {
    console.warn('runServerAction failed', action.type, result.error);
    return;
  }
  commitRoomState(roomCode, result.state);
  processEventsForTimers(roomCode, result.events);
  broadcastState(roomCode);
}

// Inspect reducer events and (re)arm the auction timer. Both `auctionStart`
// (queue drain on End Turn) and `bid` (timer reset) carry an `endsAtMs`. When
// the auction settles, an `auctionEnd` event triggers the cancel — but if the
// drain immediately starts a chained auction, the subsequent `auctionStart`
// in the same event batch overrides the cancel, which is correct.
function processEventsForTimers(roomCode, events) {
  if (!events || events.length === 0) return;
  let scheduled = false;
  let cancelled = false;
  for (const e of events) {
    if (e.type === 'auctionStart' && e.payload?.endsAtMs) {
      scheduleAuctionEnd(roomCode, e.payload.endsAtMs);
      scheduled = true;
      cancelled = false;
    } else if (e.type === 'bid' && e.payload?.endsAtMs) {
      scheduleAuctionEnd(roomCode, e.payload.endsAtMs);
      scheduled = true;
      cancelled = false;
    } else if (e.type === 'auctionEnd') {
      if (!scheduled) {
        cancelAuctionEnd();
        cancelled = true;
      } else {
        // A later auctionStart in the same batch will rearm; keep current sched.
        cancelled = false;
      }
    }
  }
  // Reading 'cancelled' here is just for completeness; cancel/schedule already
  // applied above.
  void cancelled;
}

// ---- BROADCAST ----

function broadcastState(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;
  const sockets = roomSockets.get(roomCode);
  if (!sockets) return;
  const payload = JSON.stringify({ type: S2C.STATE, gameState: scrubState(room) });
  for (const s of sockets) {
    if (s.readyState === 1) s.send(payload);
  }
}

function sendWelcome(socket, room, seat) {
  socket.send(JSON.stringify({
    type: S2C.WELCOME,
    playerToken: seat.playerToken,
    seat: seat.seat,
    roomCode: room.code,
    gameState: scrubState(room)
  }));
}

function sendError(socket, code, message) {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify({ type: S2C.ERROR, code, message: message ?? code }));
}

// Strip per-seat secret playerToken from the broadcasted state. Each client receives only
// non-secret fields; their own token came in their welcome message.
function scrubState(room) {
  const hostSeat = room.seats.find((s) => s.playerToken === room.hostPlayerToken)?.seat ?? null;
  const { hostPlayerToken, rngSeed, rngCursor, reserveDecks, ...rest } = room;
  return {
    ...rest,
    hostSeat,
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
    seats: room.seats.map((s) => ({
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
      creditCards: s.creditCards,
      stockLots: s.stockLots,
      stockCostBasis: s.stockCostBasis,
      transactions: s.transactions,
      eventInventory: s.eventInventory,
      tempEffects: s.tempEffects,
      hysaRate: s.hysaRate,
      loanTurnResponded: s.loanTurnResponded,
      pendingLoanOffer: s.pendingLoanOffer ?? null,
      lastDrawnEventCard: s.lastDrawnEventCard ?? null,
      drewEventCardThisTurn: s.drewEventCardThisTurn ?? false
    })),
    chance: { deckSize: room.chance.deck.length, discardSize: room.chance.discard.length },
    communityChest: {
      deckSize: room.communityChest.deck.length,
      discardSize: room.communityChest.discard.length
    }
  };
}

// ---- SOCKET BOOKKEEPING ----

function registerSocket(socket, roomCode, playerToken, seatIndex) {
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
