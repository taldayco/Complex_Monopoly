import { BOARD } from '../shared/board.js';
import {
  RAILROAD_RENT,
  UTILITY_MULT,
  COLOR_GROUPS
} from '../shared/constants.js';
import {
  ownedRailroadCount,
  ownedUtilityCount
} from './selectors.js';

// Compute rent owed when seat-debtor lands on space `index`, owned by ownerSeat.
// `diceTotal` is required for utility rent. `multiplier` lets a Chance card force 2x railroad
// or 10x utility regardless of how many the owner has.
export function computeRent(state, index, diceTotal, opts = {}) {
  const space = BOARD[index];
  if (!space) return 0;
  const prop = state.properties[index];
  if (!prop || prop.ownerSeat == null) return 0;
  if (prop.mortgaged) return 0;
  const ownerSeat = prop.ownerSeat;

  if (space.type === 'property') {
    const houses = prop.houses;
    if (houses > 0) {
      return space.rent[houses];
    }
    const fullGroup = ownsWholeGroup(state, ownerSeat, space.colorGroup);
    return fullGroup ? space.rent[0] * 2 : space.rent[0];
  }

  if (space.type === 'railroad') {
    const count = ownedRailroadCount(state, ownerSeat);
    let rent = RAILROAD_RENT[Math.max(0, count - 1)] ?? 0;
    if (opts.railroadMultiplier) rent *= opts.railroadMultiplier;
    return rent;
  }

  if (space.type === 'utility') {
    if (opts.utilityMultiplier) {
      return diceTotal * opts.utilityMultiplier;
    }
    const count = ownedUtilityCount(state, ownerSeat);
    const mult = UTILITY_MULT[Math.max(0, count - 1)] ?? UTILITY_MULT[0];
    return diceTotal * mult;
  }

  return 0;
}

function ownsWholeGroup(state, seatIndex, group) {
  const indices = COLOR_GROUPS[group] ?? [];
  return indices.length > 0 && indices.every((i) => state.properties[i]?.ownerSeat === seatIndex);
}
