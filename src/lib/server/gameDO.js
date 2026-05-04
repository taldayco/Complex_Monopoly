import { initRooms, setPersistence } from './roomManager.js';
import { handleMessage, handleConnect, handleDisconnect, runServerAction } from './dispatch.js';
import { createDOPersistence } from './doPersistence.js';
import { setAuctionTimer } from './auctionTimer.js';

const ACTIVE_AUCTION_KEY = 'activeAuctionRoomCode';

// Single Durable Object instance (singleton via idFromName('default')) that
// owns every room. WebSockets attach here; messages flow through the same
// dispatcher used by the Node server. Auction expiry runs via the DO's
// `alarm()` method — only one auction-timer slot exists at a time, which is
// fine because at most one room can have a live auction window in flight per
// DO process.
export class GameDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.ready = state.blockConcurrencyWhile(async () => {
      setPersistence(createDOPersistence(state.storage));
      setAuctionTimer({
        async schedule(roomCode, endsAtMs) {
          await state.storage.put(ACTIVE_AUCTION_KEY, roomCode);
          await state.storage.setAlarm(endsAtMs);
        },
        async cancel() {
          await state.storage.delete(ACTIVE_AUCTION_KEY);
          await state.storage.deleteAlarm();
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
    const roomCode = await this.state.storage.get(ACTIVE_AUCTION_KEY);
    if (!roomCode) return;
    runServerAction(roomCode, { type: 'auctionTick', _server: true });
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
