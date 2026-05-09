// Per-room session persistence.
//
// Two storage layers:
// - sessionStorage holds the ACTIVE session for THIS browser tab. Each tab
//   gets its own. This is the single source of truth for which seat the user
//   is playing, so two tabs in the same browser (e.g. host + joining player
//   for local testing) don't clobber each other's identity.
// - localStorage holds a fallback "last session per room" so that if the user
//   closes the tab and re-opens /room/X later, they can resume as their last
//   identity. It also powers the "Recent rooms" list on the landing page.
//
// loadSession prefers sessionStorage, falls back to localStorage.

const PREFIX = 'monopoly:session:';

function safeGet(store, key) {
  try {
    const raw = store.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadSession(roomCode) {
  if (typeof window === 'undefined') return null;
  const key = PREFIX + roomCode;
  return safeGet(sessionStorage, key) ?? safeGet(localStorage, key);
}

export function saveSession(roomCode, session) {
  if (typeof window === 'undefined') return;
  const key = PREFIX + roomCode;
  const json = JSON.stringify(session);
  try { sessionStorage.setItem(key, json); } catch {}
  try { localStorage.setItem(key, json); } catch {}
}

export function clearSession(roomCode) {
  if (typeof window === 'undefined') return;
  const key = PREFIX + roomCode;
  try { sessionStorage.removeItem(key); } catch {}
  try { localStorage.removeItem(key); } catch {}
}

export function listSessions() {
  if (typeof localStorage === 'undefined') return [];
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(PREFIX)) continue;
    try {
      const s = JSON.parse(localStorage.getItem(k));
      if (s) out.push(s);
    } catch {}
  }
  return out;
}
