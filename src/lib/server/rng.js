// Mulberry32 PRNG: tiny, fast, good enough for game dice and shuffling. Deterministic given seed+cursor.
export function makeRng(seed, cursor = 0) {
  let s = (seed + cursor * 0x9e3779b1) >>> 0;
  return function rand() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
