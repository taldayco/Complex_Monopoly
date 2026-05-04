import { conn, session, game, setError } from './stores.svelte.js';
import { saveSession } from './localSession.js';
import { S2C } from '../shared/messageTypes.js';

let ws = null;
let outbox = [];
let reconnectTimer = null;

export function connect() {
  if (typeof window === 'undefined') return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  conn.status = 'connecting';
  conn.error = null;

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    conn.status = 'open';
    flushOutbox();
    // If we already have a session, auto-auth.
    if (session.roomCode && session.playerToken) {
      send({ type: 'auth', roomCode: session.roomCode, playerToken: session.playerToken });
    }
  });

  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleServerMessage(msg);
  });

  ws.addEventListener('close', () => {
    conn.status = 'closed';
    ws = null;
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    // Most close events follow this; reconnect is handled in close.
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connect(), 1500);
}

export function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    outbox.push(msg);
    connect();
  }
}

function flushOutbox() {
  const batch = outbox;
  outbox = [];
  for (const m of batch) ws.send(JSON.stringify(m));
}

function handleServerMessage(msg) {
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
    case S2C.ERROR:
      setError(humanizeError(msg.code, msg.message));
      break;
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
