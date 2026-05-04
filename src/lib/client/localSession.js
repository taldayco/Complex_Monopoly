// Per-room session persistence. We key by room code so multiple games coexist (different tabs / rejoins).

const PREFIX = 'monopoly:session:';

export function loadSession(roomCode) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PREFIX + roomCode);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(roomCode, session) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PREFIX + roomCode, JSON.stringify(session));
  } catch {}
}

export function clearSession(roomCode) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(PREFIX + roomCode);
  } catch {}
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
