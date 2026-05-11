import { BOARD, isOwnable } from '../shared/board.js';
import { inflatedPrice } from '../shared/economy/inflation.js';
import { cents } from '../shared/money.js';

export function canBuy(state, seatIndex, spaceIndex) {
  const space = BOARD[spaceIndex];
  if (!space || !isOwnable(space)) return { ok: false, error: 'NOT_OWNABLE' };
  const prop = state.properties[spaceIndex];
  if (prop.ownerSeat != null) return { ok: false, error: 'OWNED' };
  const seat = state.seats[seatIndex];
  const price = inflatedPrice(state, space.price);
  if (seat.cash < price) return { ok: false, error: 'INSUFFICIENT_FUNDS' };
  return { ok: true, price };
}

export function buyProperty(state, seatIndex, spaceIndex) {
  const check = canBuy(state, seatIndex, spaceIndex);
  if (!check.ok) return check;
  const seat = state.seats[seatIndex];
  const price = check.price;
  seat.cash = cents(seat.cash - price);
  const t = transferOwnership(state, seatIndex, spaceIndex);
  if (!t.ok) {
    seat.cash = cents(seat.cash + price);
    return t;
  }
  return { ok: true, price };
}

// Pure ownership flip + price lookup. Used by both outright buy and
// buy-with-mortgage. Does NOT debit cash — the caller decides funding.
export function transferOwnership(state, seatIndex, spaceIndex) {
  const space = BOARD[spaceIndex];
  if (!space || !isOwnable(space)) return { ok: false, error: 'NOT_OWNABLE' };
  const prop = state.properties[spaceIndex];
  if (prop.ownerSeat != null) return { ok: false, error: 'OWNED' };
  prop.ownerSeat = seatIndex;
  return { ok: true, price: inflatedPrice(state, space.price) };
}

// Forced sale of a mortgaged property when transferred to a player who declines to keep mortgaged:
// (Not needed for v1; players keep mortgaged on transfer and pay 10% to unmortgage later.)
