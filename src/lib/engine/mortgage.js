import { BOARD, isOwnable } from '../shared/board.js';
import { COLOR_GROUPS, MORTGAGE_INTEREST } from '../shared/constants.js';

export function canMortgage(state, seatIndex, spaceIndex) {
  const space = BOARD[spaceIndex];
  if (!space || !isOwnable(space)) return { ok: false, error: 'NOT_OWNABLE' };
  const prop = state.properties[spaceIndex];
  if (prop.ownerSeat !== seatIndex) return { ok: false, error: 'NOT_OWNER' };
  if (prop.mortgaged) return { ok: false, error: 'ALREADY_MORTGAGED' };
  if (prop.houses > 0) return { ok: false, error: 'HAS_HOUSES' };
  // Color group must have 0 houses across all properties.
  if (space.type === 'property') {
    for (const i of COLOR_GROUPS[space.colorGroup] ?? []) {
      if (state.properties[i].houses > 0) return { ok: false, error: 'GROUP_HAS_HOUSES' };
    }
  }
  return { ok: true, payout: space.mortgageValue };
}

export function mortgage(state, seatIndex, spaceIndex) {
  const check = canMortgage(state, seatIndex, spaceIndex);
  if (!check.ok) return check;
  const space = BOARD[spaceIndex];
  const seat = state.seats[seatIndex];
  state.properties[spaceIndex].mortgaged = true;
  seat.cash += space.mortgageValue;
  return { ok: true, payout: space.mortgageValue };
}

export function canUnmortgage(state, seatIndex, spaceIndex) {
  const space = BOARD[spaceIndex];
  if (!space || !isOwnable(space)) return { ok: false, error: 'NOT_OWNABLE' };
  const prop = state.properties[spaceIndex];
  if (prop.ownerSeat !== seatIndex) return { ok: false, error: 'NOT_OWNER' };
  if (!prop.mortgaged) return { ok: false, error: 'NOT_MORTGAGED' };
  const cost = Math.ceil(space.mortgageValue * (1 + MORTGAGE_INTEREST));
  const seat = state.seats[seatIndex];
  if (seat.cash < cost) return { ok: false, error: 'INSUFFICIENT_FUNDS' };
  return { ok: true, cost };
}

export function unmortgage(state, seatIndex, spaceIndex) {
  const check = canUnmortgage(state, seatIndex, spaceIndex);
  if (!check.ok) return check;
  const seat = state.seats[seatIndex];
  state.properties[spaceIndex].mortgaged = false;
  seat.cash -= check.cost;
  return { ok: true, cost: check.cost };
}
