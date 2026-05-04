import { BOARD, isOwnable } from '../shared/board.js';

export function canBuy(state, seatIndex, spaceIndex) {
  const space = BOARD[spaceIndex];
  if (!space || !isOwnable(space)) return { ok: false, error: 'NOT_OWNABLE' };
  const prop = state.properties[spaceIndex];
  if (prop.ownerSeat != null) return { ok: false, error: 'OWNED' };
  const seat = state.seats[seatIndex];
  if (seat.cash < space.price) return { ok: false, error: 'INSUFFICIENT_FUNDS' };
  return { ok: true, price: space.price };
}

export function buyProperty(state, seatIndex, spaceIndex) {
  const check = canBuy(state, seatIndex, spaceIndex);
  if (!check.ok) return check;
  const space = BOARD[spaceIndex];
  const seat = state.seats[seatIndex];
  seat.cash -= space.price;
  state.properties[spaceIndex].ownerSeat = seatIndex;
  return { ok: true, price: space.price };
}

// Forced sale of a mortgaged property when transferred to a player who declines to keep mortgaged:
// (Not needed for v1; players keep mortgaged on transfer and pay 10% to unmortgage later.)
