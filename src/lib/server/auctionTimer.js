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

export const KIND_TO_ACTION = {
  auction: 'auctionTick',
  market: 'marketOpenTick'
};

let impl = null;

export function setTimerImpl(t) {
  impl = t;
}

export function scheduleTimer(kind, roomCode, fireAtMs) {
  if (!impl) return Promise.resolve();
  try {
    const result = impl.schedule(kind, roomCode, fireAtMs);
    if (result && typeof result.then === 'function') {
      return result.catch((e) => {
        console.error('scheduleTimer failed', kind, e?.message ?? e);
      });
    }
  } catch (e) {
    console.error('scheduleTimer failed', kind, e?.message ?? e);
  }
  return Promise.resolve();
}

export function cancelTimer(kind) {
  if (!impl) return Promise.resolve();
  try {
    const result = impl.cancel(kind);
    if (result && typeof result.then === 'function') {
      return result.catch((e) => {
        console.error('cancelTimer failed', kind, e?.message ?? e);
      });
    }
  } catch (e) {
    console.error('cancelTimer failed', kind, e?.message ?? e);
  }
  return Promise.resolve();
}

