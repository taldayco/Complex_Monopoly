// Deterministic seeded RNG used by every deck-builder and shuffler that runs
// at room creation / hydrate time, when no live `ctx.rng` is available.
//
// Same numerically-stable LCG (Numerical Recipes constants) the codebase has
// historically inlined inside createGame.js, cards.js, economy.js, stocks.js,
// and eventCards.js — consolidated here so determinism stays the same.

export function seededRng(seed, salt = 0) {
  let s = ((seed | 0) ^ (salt * 0x9e3779b1)) >>> 0;
  return function rand() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// Fisher-Yates shuffle. Mutates `arr` in place AND returns it (the engine has
// callers that want each form). Pass any rng callable returning [0, 1).
export function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function shuffled(arr, rng) {
  return shuffleInPlace(arr.slice(), rng);
}
