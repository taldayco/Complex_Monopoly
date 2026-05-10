import { createInitialRoom, newSeat, hydrateRoom } from '../engine/createGame.js';
import { generateRoomCode, generatePlayerToken } from './codes.js';
import { newSeed } from './rng.js';
import { MIN_PLAYERS, MAX_PLAYERS, FINISHED_ROOM_TTL_MS, TOKEN_PIECES } from '../shared/constants.js';

// In-memory map of code -> room. Sockets are not stored here (see connection.js).
const rooms = new Map();
let initialized = false;
let persistence = null;

export function setPersistence(p) {
  persistence = p;
}

function saveRoom(room) {
  return persistence?.saveRoom(room);
}

function deleteRoomFromStore(code) {
  return persistence?.deleteRoom(code);
}

export async function initRooms() {
  if (initialized) return;
  initialized = true;
  if (!persistence) throw new Error('roomManager: setPersistence(...) must be called before initRooms()');
  const loaded = await persistence.loadAllRooms();
  for (const [code, room] of loaded) rooms.set(code, hydrateRoom(room));
  // Periodic cleanup of finished old rooms. setInterval may be a no-op in some
  // runtimes; that's fine — cleanup will run again next time the host restarts.
  try { setInterval(cleanupFinishedRooms, 60 * 60 * 1000).unref?.(); } catch {}
}

export function getRoom(code) {
  return rooms.get(code) ?? null;
}

export function findRoomByPlayerToken(token) {
  for (const room of rooms.values()) {
    if (room.seats.some((s) => s.playerToken === token)) return room;
  }
  return null;
}

export function createRoom({ name, tokenPiece }) {
  let code;
  do {
    code = generateRoomCode();
  } while (rooms.has(code));
  const hostToken = generatePlayerToken();
  const room = createInitialRoom({ code, hostPlayerToken: hostToken, rngSeed: newSeed() });
  const seat = newSeat({
    seat: 0,
    playerToken: hostToken,
    name: sanitizeName(name),
    tokenPiece: validatePiece(tokenPiece, room) ?? TOKEN_PIECES[0]
  });
  room.seats.push(seat);
  rooms.set(code, room);
  saveRoom(room);
  return { room, seat };
}

export function joinRoom(code, { name, tokenPiece }) {
  const room = rooms.get(code);
  if (!room) return { error: 'NO_ROOM' };
  if (room.phase !== 'lobby') return { error: 'GAME_STARTED' };
  if (room.seats.length >= MAX_PLAYERS) return { error: 'ROOM_FULL' };

  const playerToken = generatePlayerToken();
  const piece = validatePiece(tokenPiece, room) ?? availablePiece(room);
  if (!piece) return { error: 'NO_PIECES' };
  const seat = newSeat({
    seat: room.seats.length,
    playerToken,
    name: sanitizeName(name),
    tokenPiece: piece
  });
  room.seats.push(seat);
  saveRoom(room);
  return { room, seat };
}

export function leaveRoom(code, playerToken) {
  const room = rooms.get(code);
  if (!room) return { error: 'NO_ROOM' };
  if (room.phase !== 'lobby') return { error: 'GAME_STARTED' };
  const idx = room.seats.findIndex((s) => s.playerToken === playerToken);
  if (idx === -1) return { error: 'NOT_IN_ROOM' };
  room.seats.splice(idx, 1);
  // Reindex seats.
  room.seats.forEach((s, i) => (s.seat = i));
  // If host left, promote the next seat to host.
  if (playerToken === room.hostPlayerToken) {
    if (room.seats.length === 0) {
      rooms.delete(code);
      deleteRoomFromStore(code);
      return { room: null };
    }
    room.hostPlayerToken = room.seats[0].playerToken;
  }
  saveRoom(room);
  return { room };
}

export function startGame(code, playerToken) {
  const room = rooms.get(code);
  if (!room) return { error: 'NO_ROOM' };
  if (room.hostPlayerToken !== playerToken) return { error: 'NOT_HOST' };
  if (room.phase !== 'lobby') return { error: 'ALREADY_STARTED' };
  if (room.seats.length < MIN_PLAYERS) return { error: 'NOT_ENOUGH_PLAYERS' };

  room.phase = 'rollOff';
  room.rollOff = {
    contenders: room.seats.map((s) => s.seat),
    rolls: {},
    settledOrder: [],
    round: 1
  };
  room.turn = { seat: 0, phase: 'preRoll', lastRoll: null, lastRollWasDoubles: false, doublesCount: 0 };
  room.log.push({ ts: Date.now(), seat: null, type: 'gameStart', payload: null });
  room.log.push({
    ts: Date.now(),
    seat: null,
    type: 'rollOffStart',
    payload: { contenders: room.rollOff.contenders, round: 1 }
  });
  saveRoom(room);
  return { room };
}

export function commitRoomState(code, nextState) {
  rooms.set(code, nextState);
  saveRoom(nextState);
}

export function setSeatConnection(code, playerToken, connected) {
  const room = rooms.get(code);
  if (!room) return null;
  const seat = room.seats.find((s) => s.playerToken === playerToken);
  if (!seat) return null;
  seat.connected = connected;
  seat.disconnectedAt = connected ? null : Date.now();
  saveRoom(room);
  return seat;
}

export function listRoomCodes() {
  return Array.from(rooms.keys());
}

function sanitizeName(name) {
  if (typeof name !== 'string') return 'Player';
  const trimmed = name.trim().slice(0, 20);
  return trimmed || 'Player';
}

function validatePiece(piece, room) {
  if (!TOKEN_PIECES.includes(piece)) return null;
  if (room.seats.some((s) => s.tokenPiece === piece)) return null;
  return piece;
}

function availablePiece(room) {
  const used = new Set(room.seats.map((s) => s.tokenPiece));
  return TOKEN_PIECES.find((p) => !used.has(p)) ?? null;
}

async function cleanupFinishedRooms() {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (room.phase === 'finished' && room.finishedAt && now - room.finishedAt > FINISHED_ROOM_TTL_MS) {
      rooms.delete(code);
      await deleteRoomFromStore(code);
    }
  }
}
