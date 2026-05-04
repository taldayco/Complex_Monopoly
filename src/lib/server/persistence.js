import { mkdir, readdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const ROOMS_DIR = join(process.cwd(), 'rooms');

const pendingTimers = new Map();
let dirReady = null;

async function ensureDir() {
  if (!dirReady) {
    dirReady = mkdir(ROOMS_DIR, { recursive: true });
  }
  await dirReady;
}

export async function loadAllRooms() {
  await ensureDir();
  const out = new Map();
  let files;
  try {
    files = await readdir(ROOMS_DIR);
  } catch {
    return out;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const text = await readFile(join(ROOMS_DIR, f), 'utf8');
      const room = JSON.parse(text);
      if (room?.code) out.set(room.code, room);
    } catch (e) {
      console.warn('Failed to load room', f, e.message);
    }
  }
  return out;
}

// Debounced atomic write per room. Multiple saveRoom calls in quick succession
// coalesce into a single disk write.
export function saveRoom(room, debounceMs = 250) {
  const key = room.code;
  clearTimeout(pendingTimers.get(key));
  const timer = setTimeout(async () => {
    pendingTimers.delete(key);
    try {
      await ensureDir();
      await atomicWrite(key, room);
    } catch (e) {
      console.error('Failed to save room', key, e.message);
    }
  }, debounceMs);
  pendingTimers.set(key, timer);
}

export async function flushRoom(roomCode) {
  const t = pendingTimers.get(roomCode);
  if (t) {
    clearTimeout(t);
    pendingTimers.delete(roomCode);
  }
}

async function atomicWrite(code, room) {
  const finalPath = join(ROOMS_DIR, `${code}.json`);
  const tmpPath = join(ROOMS_DIR, `${code}.tmp`);
  await writeFile(tmpPath, JSON.stringify(room));
  await rename(tmpPath, finalPath);
}

export async function deleteRoom(code) {
  await flushRoom(code);
  try {
    await unlink(join(ROOMS_DIR, `${code}.json`));
  } catch {}
}

export const filePersistence = { loadAllRooms, saveRoom, deleteRoom };
