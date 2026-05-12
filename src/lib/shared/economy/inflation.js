import { cents } from '../money.js';
import { GO_SALARY } from '../constants.js';

export function inflationFactorOf(state) {
  const f = state?.economy?.inflationFactor;
  return typeof f === 'number' && Number.isFinite(f) && f > 0 ? f : 1;
}

export function inflatedPrice(state, base) {
  if (typeof base !== 'number' || !Number.isFinite(base)) return base;
  const factor = inflationFactorOf(state);
  return cents(base * factor);
}

export function inflatedSalary(state, base = GO_SALARY) {
  return inflatedPrice(state, base);
}
