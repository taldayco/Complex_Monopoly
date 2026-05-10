import { conn, session, game, setError } from './stores.svelte.js';
import { saveSession, clearSession } from './localSession.js';
import { S2C } from '../shared/messageTypes.js';

let ws = null;
let outbox = [];
let reconnectTimer = null;
let reconnectAttempt = 0;
let heartbeatTimer = null;
let lastPongAt = 0;

const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 50_000;

function dbg(...args) {
  if (typeof window !== 'undefined' && window.__monopoly?.debug) {
    console.log('[ws]', ...args);
  }
}

export function connect() {
  if (typeof window === 'undefined') return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  conn.status = 'connecting';
  conn.error = null;

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    conn.status = 'open';
    reconnectAttempt = 0;
    lastPongAt = Date.now();
    // If the page already queued an auth (typical for room/[code] mount),
    // flushing will dispatch it. If not (reconnect after a drop), fall back
    // to auto-auth from the saved session. The dedup guard avoids sending
    // auth twice when the page also pushed one.
    const hasQueuedAuth = outbox.some((m) => m?.type === 'auth');
    flushOutbox();
    if (!hasQueuedAuth && session.roomCode && session.playerToken) {
      send({ type: 'auth', roomCode: session.roomCode, playerToken: session.playerToken });
    }
    startHeartbeat();
  });

  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleServerMessage(msg);
  });

  ws.addEventListener('close', () => {
    conn.status = 'closed';
    ws = null;
    stopHeartbeat();
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    // Close handler runs the reconnect.
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectAttempt += 1;
  // Exponential backoff with jitter, capped at 30s.
  const base = Math.min(30_000, 500 * Math.pow(2, Math.min(reconnectAttempt, 6)));
  const delay = base + Math.floor(Math.random() * 500);
  reconnectTimer = setTimeout(() => connect(), delay);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastPongAt > PONG_TIMEOUT_MS) {
      dbg('heartbeat timeout — forcing reconnect');
      try { ws.close(); } catch {}
      return;
    }
    try { ws.send(JSON.stringify({ type: 'ping', t: Date.now() })); } catch {}
  }, PING_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer != null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    dbg('▶', msg.type, msg);
    try { ws.send(JSON.stringify(msg)); }
    catch (e) {
      dbg('send threw, requeueing', e?.message ?? e);
      outbox.push(msg);
    }
  } else {
    dbg('⏸ outbox', msg.type, msg);
    outbox.push(msg);
    connect();
  }
}

function flushOutbox() {
  const batch = outbox;
  outbox = [];
  for (const m of batch) {
    try { ws.send(JSON.stringify(m)); }
    catch (e) {
      dbg('flush failed, requeueing', e?.message ?? e);
      outbox.push(m);
    }
  }
}

function handleServerMessage(msg) {
  dbg('◀', msg.type, msg.type === 'state' ? `phase=${msg.gameState?.phase}` : msg);
  switch (msg.type) {
    case S2C.WELCOME:
      session.roomCode = msg.roomCode;
      session.playerToken = msg.playerToken;
      session.seat = msg.seat;
      saveSession(msg.roomCode, {
        roomCode: msg.roomCode,
        playerToken: msg.playerToken,
        seat: msg.seat
      });
      game.state = msg.gameState;
      break;
    case S2C.STATE:
      game.state = msg.gameState;
      break;
    case S2C.PING:
      lastPongAt = Date.now();
      break;
    case S2C.ERROR:
      handleErrorMessage(msg);
      break;
  }
}

function handleErrorMessage(msg) {
  setError(humanizeError(msg.code, msg.message));
  // Stale session — server has no record of this room or this seat. Clearing
  // the local session prevents the reconnect loop from re-auth'ing forever
  // and bounces the user home so they can join a real room.
  if ((msg.code === 'NO_ROOM' || msg.code === 'NOT_IN_ROOM') &&
      typeof window !== 'undefined' && session.roomCode) {
    const stale = session.roomCode;
    clearSession(stale);
    session.roomCode = null;
    session.playerToken = null;
    session.seat = null;
    game.state = null;
    if (window.location.pathname.startsWith(`/room/${stale}`)) {
      window.location.replace('/');
    }
  }
}

function humanizeError(code, message) {
  const map = {
    NOT_YOUR_TURN: "It isn't your turn.",
    BAD_PHASE: "You can't do that right now.",
    BLOCKED_BY_PENDING: 'A pending action is in progress.',
    INSUFFICIENT_FUNDS: 'Not enough cash.',
    NO_BUY_DECISION: "There isn't a buy decision pending.",
    NOT_OWNER: 'You do not own that property.',
    NO_MONOPOLY: 'You need the full color group to build.',
    EVEN_BUILD: 'Houses must be built evenly across the group.',
    EVEN_SELL: 'Houses must be sold evenly across the group.',
    GROUP_HAS_HOUSES: 'Sell all houses in the group before mortgaging.',
    HAS_HOUSES: 'That property has houses.',
    NO_TRADE: 'No trade is pending.',
    NO_AUCTION: 'No auction is in progress.',
    NOT_HOST: 'Only the host can do that.',
    NO_ROOM: "That room doesn't exist.",
    GAME_STARTED: 'The game has already started.',
    ROOM_FULL: 'That room is full.',
    NOT_ENOUGH_PLAYERS: 'You need at least 2 players to start.'
  };
  return map[code] || message || code;
}

export function disconnect() {
  if (ws) ws.close();
  ws = null;
}
