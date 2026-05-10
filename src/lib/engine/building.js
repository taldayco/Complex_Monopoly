import { BOARD } from '../shared/board.js';
import { COLOR_GROUPS } from '../shared/constants.js';
import { getDevelopmentRebateFor } from '../shared/reserve/cardCatalog.js';
import { inflatedPrice } from '../shared/economy/inflation.js';

function effectiveDevelopmentCost(state, seat, listedCost) {
  const inflated = inflatedPrice(state, listedCost);
  const rebate = getDevelopmentRebateFor(seat);
  if (rebate <= 0) return inflated;
  return Math.round(inflated * (1 - rebate) * 100) / 100;
}

export function calcPermitFees(state, seatIndex, spaceIndex, devSubtotal) {
  const space = BOARD[spaceIndex];
  if (!space || space.type !== 'property') return { feesByRecipient: new Map(), totalFees: 0 };
  const feePerProperty = Math.round(devSubtotal * 0.25 * 100) / 100;
  const feesByRecipient = new Map();
  let totalFees = 0;
  for (const i of COLOR_GROUPS[space.colorGroup] ?? []) {
    if (i === spaceIndex) continue;
    const owner = state.properties[i]?.ownerSeat;
    if (owner == null || owner === seatIndex) continue;
    const cur = feesByRecipient.get(owner) ?? 0;
    feesByRecipient.set(owner, Math.round((cur + feePerProperty) * 100) / 100);
    totalFees = Math.round((totalFees + feePerProperty) * 100) / 100;
  }
  return { feesByRecipient, totalFees, feePerProperty };
}

export function canBuyHouse(state, seatIndex, spaceIndex) {
  const space = BOARD[spaceIndex];
  if (!space || space.type !== 'property') return { ok: false, error: 'NOT_PROPERTY' };
  const prop = state.properties[spaceIndex];
  if (prop.ownerSeat !== seatIndex) return { ok: false, error: 'NOT_OWNER' };
  if (prop.mortgaged) return { ok: false, error: 'MORTGAGED' };
  if (prop.houses >= 5) return { ok: false, error: 'AT_HOTEL' };

  const target = prop.houses + 1;
  for (const i of COLOR_GROUPS[space.colorGroup]) {
    if (i === spaceIndex) continue;
    if (state.properties[i]?.ownerSeat !== seatIndex) continue;
    if (state.properties[i].mortgaged) return { ok: false, error: 'GROUP_MORTGAGED' };
    if (state.properties[i].houses < target - 1) {
      return { ok: false, error: 'EVEN_BUILD' };
    }
  }

  if (target === 5) {
    if (state.bank.hotelsAvailable < 1) return { ok: false, error: 'NO_HOTELS' };
  } else {
    if (state.bank.housesAvailable < 1) return { ok: false, error: 'NO_HOUSES' };
  }

  const seat = state.seats[seatIndex];
  const cost = effectiveDevelopmentCost(state, seat, space.houseCost);
  const fees = calcPermitFees(state, seatIndex, spaceIndex, cost);
  if (seat.cash < cost + fees.totalFees) return { ok: false, error: 'INSUFFICIENT_FUNDS' };

  return {
    ok: true,
    cost,
    listedCost: space.houseCost,
    permitFees: fees.totalFees,
    feesByRecipient: fees.feesByRecipient
  };
}

export function buyHouse(state, seatIndex, spaceIndex) {
  const check = canBuyHouse(state, seatIndex, spaceIndex);
  if (!check.ok) return check;
  const space = BOARD[spaceIndex];
  const prop = state.properties[spaceIndex];
  const seat = state.seats[seatIndex];
  const target = prop.houses + 1;

  for (const [recipientSeat, amount] of check.feesByRecipient.entries()) {
    const recipient = state.seats[recipientSeat];
    if (!recipient) continue;
    seat.cash = Math.round((seat.cash - amount) * 100) / 100;
    recipient.cash = Math.round((recipient.cash + amount) * 100) / 100;
  }

  if (target === 5) {
    state.bank.housesAvailable += 4;
    state.bank.hotelsAvailable -= 1;
  } else {
    state.bank.housesAvailable -= 1;
  }
  prop.houses = target;
  seat.cash = Math.round((seat.cash - check.cost) * 100) / 100;
  return {
    ok: true,
    cost: check.cost,
    listedCost: space.houseCost,
    houses: target,
    permitFees: check.permitFees,
    feesByRecipient: check.feesByRecipient
  };
}

export function canSellHouse(state, seatIndex, spaceIndex) {
  const space = BOARD[spaceIndex];
  if (!space || space.type !== 'property') return { ok: false, error: 'NOT_PROPERTY' };
  const prop = state.properties[spaceIndex];
  if (prop.ownerSeat !== seatIndex) return { ok: false, error: 'NOT_OWNER' };
  if (prop.houses === 0) return { ok: false, error: 'NO_HOUSES' };

  const target = prop.houses - 1;
  for (const i of COLOR_GROUPS[space.colorGroup]) {
    if (i === spaceIndex) continue;
    if (state.properties[i]?.ownerSeat !== seatIndex) continue;
    if (state.properties[i].houses > target + 1) {
      return { ok: false, error: 'EVEN_SELL' };
    }
  }

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
