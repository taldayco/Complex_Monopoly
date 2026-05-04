import { BOARD_SIZE, GO_INDEX, GO_SALARY } from '../shared/constants.js';

// Returns { d1, d2, total, doubles }. rng is a function () => float in [0, 1).
export function rollDice(rng) {
  const d1 = 1 + Math.floor(rng() * 6);
  const d2 = 1 + Math.floor(rng() * 6);
  return { d1, d2, total: d1 + d2, doubles: d1 === d2 };
}

// Mutates seat in place: position + cash + GO collection. Returns { passedGo }.
export function advancePosition(seat, steps, { collectGoOnPass = true } = {}) {
  const before = seat.position;
  let after = (before + steps) % BOARD_SIZE;
  if (after < 0) after += BOARD_SIZE;
  let passedGo = false;
  if (steps > 0 && collectGoOnPass && (before + steps) >= BOARD_SIZE) {
    seat.cash += GO_SALARY;
    passedGo = true;
  }
  seat.position = after;
  return { passedGo };
}

// Move to a specific space. If forward and crosses GO, collect $200 (unless explicitly skipped).
export function moveTo(seat, target, { collectGoOnPass = true, backward = false } = {}) {
  const before = seat.position;
  const steps = backward
    ? -((before - target + BOARD_SIZE) % BOARD_SIZE)
    : ((target - before + BOARD_SIZE) % BOARD_SIZE);
  if (steps === 0) return { passedGo: false };
  return advancePosition(seat, steps, { collectGoOnPass });
}

export function isGoIndex(i) {
  return i === GO_INDEX;
}
