import { BOARD } from '../shared/board.js';
import { COLOR_GROUPS } from '../shared/constants.js';
import { ownsAllInGroup } from './selectors.js';
import { getDevelopmentRebateFor } from '../shared/reserve/cardCatalog.js';

// Effective house/hotel cost after card-driven development rebates. The bank
// covers the rebated portion implicitly — no separate accounting needed since
// houses/hotels are bank-owned inventory.
function effectiveDevelopmentCost(seat, listedCost) {
  const rebate = getDevelopmentRebateFor(seat);
  if (rebate <= 0) return listedCost;
  return Math.round(listedCost * (1 - rebate) * 100) / 100;
}

// "Even build" rule: you must build/sell across the color group such that no two properties
// differ in house count by more than 1.

export function canBuyHouse(state, seatIndex, spaceIndex) {
  const space = BOARD[spaceIndex];
  if (!space || space.type !== 'property') return { ok: false, error: 'NOT_PROPERTY' };
  const prop = state.properties[spaceIndex];
  if (prop.ownerSeat !== seatIndex) return { ok: false, error: 'NOT_OWNER' };
  if (prop.mortgaged) return { ok: false, error: 'MORTGAGED' };
  if (!ownsAllInGroup(state, seatIndex, space.colorGroup)) return { ok: false, error: 'NO_MONOPOLY' };
  if (prop.houses >= 5) return { ok: false, error: 'AT_HOTEL' };

  // Cannot have any mortgaged property in this color group.
  for (const i of COLOR_GROUPS[space.colorGroup]) {
    if (state.properties[i].mortgaged) return { ok: false, error: 'GROUP_MORTGAGED' };
  }

  // Even-build: target houses on this property would be houses+1.
  // Every other property in the group must currently have at least houses (>= target - 1).
  const target = prop.houses + 1;
  for (const i of COLOR_GROUPS[space.colorGroup]) {
    if (i === spaceIndex) continue;
    if (state.properties[i].houses < target - 1) {
      return { ok: false, error: 'EVEN_BUILD' };
    }
  }

  // Bank inventory.
  if (target === 5) {
    if (state.bank.hotelsAvailable < 1) return { ok: false, error: 'NO_HOTELS' };
  } else {
    if (state.bank.housesAvailable < 1) return { ok: false, error: 'NO_HOUSES' };
  }

  // Cash.
  const seat = state.seats[seatIndex];
  const cost = effectiveDevelopmentCost(seat, space.houseCost);
  if (seat.cash < cost) return { ok: false, error: 'INSUFFICIENT_FUNDS' };

  return { ok: true, cost, listedCost: space.houseCost };
}

export function buyHouse(state, seatIndex, spaceIndex) {
  const check = canBuyHouse(state, seatIndex, spaceIndex);
  if (!check.ok) return check;
  const space = BOARD[spaceIndex];
  const prop = state.properties[spaceIndex];
  const seat = state.seats[seatIndex];
  const target = prop.houses + 1;

  if (target === 5) {
    // Hotel: returns 4 houses to bank, takes 1 hotel.
    state.bank.housesAvailable += 4;
    state.bank.hotelsAvailable -= 1;
  } else {
    state.bank.housesAvailable -= 1;
  }
  prop.houses = target;
  const cost = effectiveDevelopmentCost(seat, space.houseCost);
  seat.cash = Math.round((seat.cash - cost) * 100) / 100;
  return { ok: true, cost, listedCost: space.houseCost, houses: target };
}

export function canSellHouse(state, seatIndex, spaceIndex) {
  const space = BOARD[spaceIndex];
  if (!space || space.type !== 'property') return { ok: false, error: 'NOT_PROPERTY' };
  const prop = state.properties[spaceIndex];
  if (prop.ownerSeat !== seatIndex) return { ok: false, error: 'NOT_OWNER' };
  if (prop.houses === 0) return { ok: false, error: 'NO_HOUSES' };

  // Even-sell: every other property in the group must have at most current houses (>= target after sell).
  const target = prop.houses - 1;
  for (const i of COLOR_GROUPS[space.colorGroup]) {
    if (i === spaceIndex) continue;
    if (state.properties[i].houses > target + 1) {
      return { ok: false, error: 'EVEN_SELL' };
    }
  }

  // Hotel sell-back requires 4 houses available in the bank.
  if (prop.houses === 5 && state.bank.housesAvailable < 4) {
    return { ok: false, error: 'NO_HOUSES_IN_BANK' };
  }

  return { ok: true, refund: Math.floor(space.houseCost / 2) };
}

export function sellHouse(state, seatIndex, spaceIndex) {
  const check = canSellHouse(state, seatIndex, spaceIndex);
  if (!check.ok) return check;
  const space = BOARD[spaceIndex];
  const prop = state.properties[spaceIndex];
  const seat = state.seats[seatIndex];
  const refund = Math.floor(space.houseCost / 2);

  if (prop.houses === 5) {
    // Hotel → 4 houses
    state.bank.hotelsAvailable += 1;
    state.bank.housesAvailable -= 4;
    prop.houses = 4;
  } else {
    state.bank.housesAvailable += 1;
    prop.houses -= 1;
  }
  seat.cash += refund;
  return { ok: true, refund, houses: prop.houses };
}
