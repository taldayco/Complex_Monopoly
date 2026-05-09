import { initRooms, setPersistence } from './roomManager.js';
import { handleMessage, handleConnect, handleDisconnect, runServerAction } from './dispatch.js';
import { createDOPersistence } from './doPersistence.js';
import { setTimerImpl } from './auctionTimer.js';

const PENDING_TIMERS_KEY = 'pendingTimers';

const KIND_TO_ACTION = {
  auction: 'auctionTick',
  market: 'marketOpenTick'
};

// Single Durable Object instance (singleton via idFromName('default')) that
// owns every room. WebSockets attach here; messages flow through the same
// dispatcher used by the Node server.
//
// Timers: the DO has only one pending alarm slot, so we multiplex multiple
// timer kinds (auction window expiry, market-open per-second ticks) by storing
// `{ auction?: {roomCode, fireAtMs}, market?: {roomCode, fireAtMs} }` under
// PENDING_TIMERS_KEY. `schedule` updates the map and re-arms the alarm to the
// soonest fireAtMs. `alarm()` reads the map, fires every entry whose fireAtMs
// is due, removes it, and re-arms to the next earliest if any remain.
export class GameDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.ready = state.blockConcurrencyWhile(async () => {
      setPersistence(createDOPersistence(state.storage));
      setTimerImpl({
        schedule: async (kind, roomCode, fireAtMs) => {
          const map = (await state.storage.get(PENDING_TIMERS_KEY)) ?? {};
          map[kind] = { roomCode, fireAtMs };
          await state.storage.put(PENDING_TIMERS_KEY, map);
          await rearmAlarm(state.storage, map);
        },
        cancel: async (kind) => {
          const map = (await state.storage.get(PENDING_TIMERS_KEY)) ?? {};
          if (!(kind in map)) return;
          delete map[kind];
          await state.storage.put(PENDING_TIMERS_KEY, map);
          await rearmAlarm(state.storage, map);
        }
      });
      await initRooms();
    });
  }

  async fetch(req) {
    await this.ready;

    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.attachSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm() {
    await this.ready;
    const map = (await this.state.storage.get(PENDING_TIMERS_KEY)) ?? {};
    const now = Date.now();
    const due = [];
    for (const [kind, entry] of Object.entries(map)) {
      if (entry?.fireAtMs != null && entry.fireAtMs <= now) {
        due.push({ kind, roomCode: entry.roomCode });
        delete map[kind];
      }
    }
    if (due.length > 0) {
      await this.state.storage.put(PENDING_TIMERS_KEY, map);
    }
    for (const { kind, roomCode } of due) {
      const actionType = KIND_TO_ACTION[kind];
      if (!actionType) continue;
      runServerAction(roomCode, { type: actionType, _server: true });
    }
    await rearmAlarm(this.state.storage, map);
  }

  attachSocket(ws) {
    handleConnect(ws);

    ws.addEventListener('message', (event) => {
      const data = typeof event.data === 'string'
        ? event.data
        : new TextDecoder().decode(event.data);
      try {
        handleMessage(ws, data);
      } catch (e) {
        console.error('handleMessage error', e);
        try {
          ws.send(JSON.stringify({ type: 'error', code: 'INTERNAL', message: e?.message ?? String(e) }));
        } catch {}
      }
    });

    ws.addEventListener('close', () => {
      try { handleDisconnect(ws); } catch (e) { console.error('handleDisconnect error', e); }
    });

    ws.addEventListener('error', (e) => {
      console.warn('socket error', e?.message ?? e);
    });
  }
}

async function rearmAlarm(storage, map) {
  const times = Object.values(map)
    .map((e) => e?.fireAtMs)
    .filter((t) => typeof t === 'number');
  if (times.length === 0) {
    await storage.deleteAlarm();
    return;
  }
  await storage.setAlarm(Math.min(...times));
}
