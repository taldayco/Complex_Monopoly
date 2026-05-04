// Pluggable auction timer abstraction. Each server entrypoint installs its own
// implementation via `setAuctionTimer`:
//   - Node (server.js + wsServer.js) uses setTimeout.
//   - Cloudflare Worker (gameDO.js) uses Durable Object alarms.
//
// `dispatch.js` calls `scheduleAuctionEnd` whenever the reducer emits an
// `auctionStart` event (or a `bid` event with a refreshed `endsAtMs`), and
// `cancelAuctionEnd` when the reducer emits `auctionEnd`. Calls are
// fire-and-forget — failures are logged but do not surface to clients.

let impl = null;

export function setAuctionTimer(t) {
  impl = t;
}

export function scheduleAuctionEnd(roomCode, endsAtMs) {
  if (!impl) return;
  try {
    const result = impl.schedule(roomCode, endsAtMs);
    if (result && typeof result.catch === 'function') {
      result.catch((e) => console.error('scheduleAuctionEnd failed', e?.message ?? e));
    }
  } catch (e) {
    console.error('scheduleAuctionEnd failed', e?.message ?? e);
  }
}

export function cancelAuctionEnd() {
  if (!impl) return;
  try {
    const result = impl.cancel();
    if (result && typeof result.catch === 'function') {
      result.catch((e) => console.error('cancelAuctionEnd failed', e?.message ?? e));
    }
  } catch (e) {
    console.error('cancelAuctionEnd failed', e?.message ?? e);
  }
}
