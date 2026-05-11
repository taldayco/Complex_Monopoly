import { BOARD_SIZE, GO_INDEX, GO_SALARY } from '../shared/constants.js';
import { cents } from '../shared/money.js';

export function rollDice(rng) {
  const d1 = 1 + Math.floor(rng() * 6);
  const d2 = 1 + Math.floor(rng() * 6);
  return { d1, d2, total: d1 + d2, doubles: d1 === d2 };
}

export function advancePosition(seat, steps, { collectGoOnPass = true } = {}) {
  const before = seat.position;
  let after = (before + steps) % BOARD_SIZE;
  if (after < 0) after += BOARD_SIZE;
  let passedGo = false;
  if (steps > 0 && collectGoOnPass && (before + steps) >= BOARD_SIZE) {
    seat.cash = cents(seat.cash + GO_SALARY);
    passedGo = true;
  }
  seat.position = after;
  return { passedGo };
}

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
