import { initRooms, setPersistence } from './roomManager.js';
import { handleMessage, handleConnect, handleDisconnect, runServerAction } from './dispatch.js';
import { filePersistence } from './persistence.js';
import { setTimerImpl, KIND_TO_ACTION } from './auctionTimer.js';

let initialized = false;
const nodeTimers = new Map(); // kind -> { handle, roomCode }

function installNodeTimers() {
  setTimerImpl({
    schedule(kind, roomCode, fireAtMs) {
      const existing = nodeTimers.get(kind);
      if (existing?.handle) clearTimeout(existing.handle);
      const delay = Math.max(0, fireAtMs - Date.now());
      const handle = setTimeout(() => {
        nodeTimers.delete(kind);
        const actionType = KIND_TO_ACTION[kind];
        if (!actionType) return;
        runServerAction(roomCode, { type: actionType, _server: true });
      }, delay);
      // Don't keep the event loop alive solely for a game timer.
      handle?.unref?.();
      nodeTimers.set(kind, { handle, roomCode });
    },
    cancel(kind) {
      const existing = nodeTimers.get(kind);
      if (existing?.handle) clearTimeout(existing.handle);
      nodeTimers.delete(kind);
    }
  });
}

export async function attachGameServer(wss) {
  if (!initialized) {
    initialized = true;
    setPersistence(filePersistence);
    installNodeTimers();
    await initRooms();
  }
  wss.on('connection', (socket) => {
    handleConnect(socket);

    socket.on('message', (data) => {
      try {
        handleMessage(socket, data.toString());
      } catch (e) {
        console.error('handleMessage error', e);
        try {
          socket.send(JSON.stringify({ type: 'error', code: 'INTERNAL', message: e.message }));
        } catch {}
      }
    });

    socket.on('close', () => {
      try {
        handleDisconnect(socket);
      } catch (e) {
        console.error('handleDisconnect error', e);
      }
    });

    socket.on('error', (err) => {
      console.warn('socket error', err.message);
    });
  });
}
