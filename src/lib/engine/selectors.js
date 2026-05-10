import { BOARD, isOwnable } from '../shared/board.js';
import { COLOR_GROUPS, RAILROAD_INDICES, UTILITY_INDICES } from '../shared/constants.js';
import { inflatedPrice } from '../shared/economy/inflation.js';

export function activeSeats(state) {
  return state.seats.filter((s) => !s.bankrupt);
}

export function seatBySeatIndex(state, seatIndex) {
  return state.seats.find((s) => s.seat === seatIndex) ?? null;
}

export function seatByToken(state, token) {
  return state.seats.find((s) => s.playerToken === token) ?? null;
}

export function ownedBy(state, seatIndex) {
  return Object.entries(state.properties)
    .filter(([, p]) => p.ownerSeat === seatIndex)
    .map(([i]) => Number(i));
}

export function ownsAllInGroup(state, seatIndex, colorGroup) {
  const indices = COLOR_GROUPS[colorGroup];
  if (!indices) return false;
  return indices.every((i) => state.properties[i]?.ownerSeat === seatIndex);
}

export function ownedRailroadCount(state, seatIndex) {
  return RAILROAD_INDICES.filter((i) => state.properties[i]?.ownerSeat === seatIndex).length;
}

export function ownedUtilityCount(state, seatIndex) {
  return UTILITY_INDICES.filter((i) => state.properties[i]?.ownerSeat === seatIndex).length;
}

export function countOwnedProperties(state, seatIndex) {
  let count = 0;
  for (const idx of Object.keys(state.properties ?? {})) {
    if (state.properties[idx]?.ownerSeat === seatIndex) count += 1;
  }
  return count;
}

export function countOwnedDevelopments(state, seatIndex) {
  let total = 0;
  for (const idx of Object.keys(state.properties ?? {})) {
    const prop = state.properties[idx];
    if (prop?.ownerSeat !== seatIndex) continue;
    const h = prop.houses ?? 0;
    if (h === 0) continue;
    if (h === 5) total += 3;
    else total += h;
  }
  return total;
}

// Net worth of a seat (cash + property prices + house investment, minus mortgage drawdowns).
// Used for deciding who wins on tie/bankruptcy edge cases. Houses sell back at half cost.
export function netWorth(state, seatIndex) {
  const seat = seatBySeatIndex(state, seatIndex);
  if (!seat) return 0;
  let total = seat.cash;
  for (const i of ownedBy(state, seatIndex)) {
    const space = BOARD[i];
    const prop = state.properties[i];
    if (prop.mortgaged) {
      total = Math.round((total + (space.mortgageValue ?? 0)) * 100) / 100;
    } else {
      total = Math.round((total + inflatedPrice(state, space.price ?? 0)) * 100) / 100;
    }
    if (prop.houses > 0 && space.houseCost) {
      const buildingValue = Math.round(inflatedPrice(state, space.houseCost) * prop.houses * 50) / 100;
      total = Math.round((total + buildingValue) * 100) / 100;
    }
  }
  return total;
}

export function totalHousesOwned(state, seatIndex) {
  let h = 0;
  for (const i of ownedBy(state, seatIndex)) {
    const prop = state.properties[i];
    if (prop.houses > 0 && prop.houses < 5) h += prop.houses;
  }
  return h;
}

export function totalHotelsOwned(state, seatIndex) {
  let h = 0;
  for (const i of ownedBy(state, seatIndex)) {
    if (state.properties[i].houses === 5) h++;
  }
  return h;
}

export function nextActiveSeatAfter(state, seatIndex) {
  const seats = state.seats;
  if (seats.length === 0) return null;
  for (let step = 1; step < seats.length; step++) {
    const next = (seatIndex + step) % seats.length;
    if (!seats[next].bankrupt) return next;
  }
  return null;
}

// Returns ownable space indices. For Chance "advance to nearest" cards.
export function nearestRailroadFrom(position) {
  for (let step = 0; step < 40; step++) {
    const idx = (position + step) % 40;
    if (RAILROAD_INDICES.includes(idx)) return idx;
  }
  return RAILROAD_INDICES[0];
}

export function nearestUtilityFrom(position) {
  for (let step = 0; step < 40; step++) {
    const idx = (position + step) % 40;
    if (UTILITY_INDICES.includes(idx)) return idx;
  }
  return UTILITY_INDICES[0];
}

export function isUnimproved(state, seatIndex) {
  // True if no properties owned by seat have houses (required to mortgage / trade properties).
  for (const i of ownedBy(state, seatIndex)) {
    if (state.properties[i].houses > 0) return false;
  }
  return true;
}

export function colorGroupOf(spaceIndex) {
  const space = BOARD[spaceIndex];
  return space?.colorGroup ?? null;
}

export function ownedSpacesInGroup(state, colorGroup) {
  return (COLOR_GROUPS[colorGroup] ?? []).map((i) => state.properties[i]);
}

// Diagnostic: ownable indices currently held by no one (used for completeness checks in tests).
export function unownedOwnableIndices(state) {
  const out = [];
  for (let i = 0; i < BOARD.length; i++) {
    if (isOwnable(BOARD[i]) && state.properties[i]?.ownerSeat == null) out.push(i);
  }
  return out;
}
