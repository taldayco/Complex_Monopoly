// Durable Object Storage backed persistence. One DO holds all rooms keyed by code.

const ROOM_PREFIX = 'room:';

export function createDOPersistence(storage) {
  return {
    async loadAllRooms() {
      const out = new Map();
      const map = await storage.list({ prefix: ROOM_PREFIX });
      for (const [, room] of map) {
        if (room?.code) out.set(room.code, room);
      }
      return out;
    },
    saveRoom(room) {
      // Fire-and-forget: the DO stays alive while a websocket is open, so the
      // write completes before eviction. Errors are logged but not surfaced.
      storage.put(ROOM_PREFIX + room.code, room).catch((e) => {
        console.error('saveRoom failed', room.code, e?.message ?? e);
      });
    },
    async deleteRoom(code) {
      try {
        await storage.delete(ROOM_PREFIX + code);
      } catch {}
    }
  };
}
