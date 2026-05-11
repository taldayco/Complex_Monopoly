// Cents-precision money primitives. The whole engine works in dollars with
// two decimals; without rounding at every arithmetic step, IEEE-754 drift
// accumulates into off-by-a-cent failures across hundreds of test cases.
//
// `cents(n)` rounds to two decimals. `addCash` / `subCash` / `transferCash`
// mutate the seat in place — match the prevailing reducer pattern (deep-clone
// happens once at the top of the reducer; everything below is mutating).

export function cents(n) {
  return Math.round(n * 100) / 100;
}

export function round4(n) {
  return Math.round(n * 10000) / 10000;
}

export function addCash(seat, n) {
  seat.cash = cents(seat.cash + n);
}

export function subCash(seat, n) {
  seat.cash = cents(seat.cash - n);
}

export function transferCash(from, to, n) {
  subCash(from, n);
  addCash(to, n);
}
