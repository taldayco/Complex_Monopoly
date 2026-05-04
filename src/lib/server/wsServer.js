import { initRooms, setPersistence } from './roomManager.js';
import { handleMessage, handleConnect, handleDisconnect, runServerAction } from './dispatch.js';
import { filePersistence } from './persistence.js';
import { setAuctionTimer } from './auctionTimer.js';

let initialized = false;
let nodeAuctionTimer = null;

function installNodeAuctionTimer() {
  setAuctionTimer({
    schedule(roomCode, endsAtMs) {
      if (nodeAuctionTimer) clearTimeout(nodeAuctionTimer);
      const delay = Math.max(0, endsAtMs - Date.now());
      nodeAuctionTimer = setTimeout(() => {
        nodeAuctionTimer = null;
        runServerAction(roomCode, { type: 'auctionTick', _server: true });
      }, delay);
      // Don't keep the event loop alive solely for an auction timer.
      nodeAuctionTimer?.unref?.();
    },
    cancel() {
      if (nodeAuctionTimer) clearTimeout(nodeAuctionTimer);
      nodeAuctionTimer = null;
    }
  });
}

export async function attachGameServer(wss) {
  if (!initialized) {
    initialized = true;
    setPersistence(filePersistence);
    installNodeAuctionTimer();
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
