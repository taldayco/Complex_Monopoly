import { JAIL_INDEX, JAIL_FINE, JAIL_MAX_TURNS } from '../shared/constants.js';
import { rollDice } from './movement.js';
import { inflatedPrice } from '../shared/economy/inflation.js';

export function sendToJail(seat) {
  seat.position = JAIL_INDEX;
  seat.inJail = true;
  seat.jailTurns = 0;
}

export function sendToJailWithSeizure(state, seatIndex) {
  const seat = state.seats[seatIndex];
  sendToJail(seat);
  const choices = ownedSeizableSpaceIndices(state, seatIndex);
  if (choices.length > 0) {
    state.pendingJailSeizureChoice = { seat: seatIndex, choices };
    return { jailed: true, seizureRequired: true, choices };
  }
  return { jailed: true, seizureRequired: false };
}

export function ownedSeizableSpaceIndices(state, seatIndex) {
  const result = [];
  for (const idx of Object.keys(state.properties ?? {})) {
    const prop = state.properties[idx];
    if (prop?.ownerSeat === seatIndex) result.push(Number(idx));
  }
  return result;
}

export function seizePropertyToBank(state, seatIndex, spaceIndex) {
  const prop = state.properties[spaceIndex];
  if (!prop || prop.ownerSeat !== seatIndex) return { error: 'NOT_OWNER' };
  prop.ownerSeat = null;
  prop.mortgaged = false;
  prop.houses = 0;
  return { ok: true, spaceIndex };
}

export function jailFine(state) {
  return inflatedPrice(state, JAIL_FINE);
}

export function attemptJailExit(state, seat, strategy, rng) {
  if (!seat.inJail) return { error: 'NOT_IN_JAIL' };
  const fine = jailFine(state);

  if (strategy === 'pay') {
    if (seat.cash < fine) return { error: 'INSUFFICIENT_FUNDS' };
    seat.cash = Math.round((seat.cash - fine) * 100) / 100;
    seat.inJail = false;
    seat.jailTurns = 0;
    return { released: true, fine };
  }

  if (strategy === 'card') {
    if (seat.getOutOfJailFreeChance) {
      seat.getOutOfJailFreeChance = false;
      seat.inJail = false;
      seat.jailTurns = 0;
      return { released: true, returnedCard: 'chance' };
    }
    if (seat.getOutOfJailFreeCommunity) {
      seat.getOutOfJailFreeCommunity = false;
      seat.inJail = false;
      seat.jailTurns = 0;
      return { released: true, returnedCard: 'communityChest' };
    }
    return { error: 'NO_JAIL_CARD' };
  }

  if (strategy === 'roll') {
    const roll = rollDice(rng);
    seat.jailTurns += 1;
    if (roll.doubles) {
      seat.inJail = false;
      seat.jailTurns = 0;
      return { released: true, roll };
    }
    if (seat.jailTurns >= JAIL_MAX_TURNS) {
      if (seat.cash < fine) {
        return { released: false, mustPay: true, roll, insolvent: true, fine };
      }
      seat.cash = Math.round((seat.cash - fine) * 100) / 100;
      seat.inJail = false;
      seat.jailTurns = 0;
      return { released: true, mustPay: true, roll, fine };
    }
    return { released: false, roll, fine };
  }

  return { error: 'UNKNOWN_STRATEGY' };
}
