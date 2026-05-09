// Pluggable, multi-kind timer abstraction. Each server entrypoint installs an
// implementation via `setTimerImpl`:
//   - Node (server.js + wsServer.js) uses one setTimeout per kind.
//   - Cloudflare Worker (gameDO.js) uses Durable Object alarms, multiplexed
//     across kinds because a DO has only one pending alarm.
//
// Two timer kinds today:
//   'auction' — fires `auctionTick` when an auction window expires.
//   'market'  — fires `marketOpenTick` once per second during a Market Open.
//
// `dispatch.js` calls `scheduleTimer(kind, roomCode, fireAtMs)` whenever the
// reducer emits a corresponding event, and `cancelTimer(kind)` when the
// reducer signals that no further ticks are needed. Calls are fire-and-forget;
// failures are logged but do not surface to clients.

let impl = null;

export function setTimerImpl(t) {
  impl = t;
}

// Backward-compat alias so existing call sites keep working.
export const setAuctionTimer = setTimerImpl;

export function scheduleTimer(kind, roomCode, fireAtMs) {
  if (!impl) return;
  try {
    const result = impl.schedule(kind, roomCode, fireAtMs);
    if (result && typeof result.catch === 'function') {
      result.catch((e) => console.error('scheduleTimer failed', kind, e?.message ?? e));
    }
  } catch (e) {
    console.error('scheduleTimer failed', kind, e?.message ?? e);
  }
}

export function cancelTimer(kind) {
  if (!impl) return;
  try {
    const result = impl.cancel(kind);
    if (result && typeof result.catch === 'function') {
      result.catch((e) => console.error('cancelTimer failed', kind, e?.message ?? e));
    }
  } catch (e) {
    console.error('cancelTimer failed', kind, e?.message ?? e);
  }
}

// ---- Backward-compat wrappers for the auction-only call sites ----

export function scheduleAuctionEnd(roomCode, endsAtMs) {
  scheduleTimer('auction', roomCode, endsAtMs);
}

export function cancelAuctionEnd() {
  cancelTimer('auction');
}
