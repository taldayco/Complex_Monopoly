// HYSA (high-yield savings) interest, paid at the start of each seat's turn.
// Rate is the seat's stored hysaRate plus any active-card bonuses.

import { getHysaRateFor } from '../../shared/reserve/cardCatalog.js';
import { HYSA_BASE_RATE } from '../../shared/constants.js';

// Pays interest on the seat's current cash balance. Returns
// { paid, rate, cashBefore, cashAfter } so the reducer can log + display.
// Pays nothing when cash is non-positive (debts / negative balances do not
// generate interest).
export function applyHysaInterestAtTurnStart(seat) {
  if (!seat || typeof seat.cash !== 'number' || seat.cash <= 0) {
    return { paid: 0, rate: 0, cashBefore: seat?.cash ?? 0, cashAfter: seat?.cash ?? 0 };
  }
  const rate = getHysaRateFor(seat, HYSA_BASE_RATE);
  if (rate <= 0) {
    return { paid: 0, rate: 0, cashBefore: seat.cash, cashAfter: seat.cash };
  }
  const before = seat.cash;
  const paid = Math.round(before * rate * 100) / 100;
  if (paid <= 0) {
    return { paid: 0, rate, cashBefore: before, cashAfter: before };
  }
  seat.cash = Math.round((before + paid) * 100) / 100;
  return { paid, rate, cashBefore: before, cashAfter: seat.cash };
}
