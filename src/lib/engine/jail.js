import { JAIL_INDEX, JAIL_FINE, JAIL_MAX_TURNS } from '../shared/constants.js';
import { rollDice } from './movement.js';

export function sendToJail(seat) {
  seat.position = JAIL_INDEX;
  seat.inJail = true;
  seat.jailTurns = 0;
}

// Returns { released, mustPay, error }.
// strategy: "roll" = attempt doubles; "pay" = pay $50; "card" = use jail-free card.
export function attemptJailExit(state, seat, strategy, rng) {
  if (!seat.inJail) return { error: 'NOT_IN_JAIL' };

  if (strategy === 'pay') {
    if (seat.cash < JAIL_FINE) return { error: 'INSUFFICIENT_FUNDS' };
    seat.cash -= JAIL_FINE;
    seat.inJail = false;
    seat.jailTurns = 0;
    return { released: true };
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
      // Must pay $50 to leave on third failed attempt; if can't, it's bankruptcy time.
      if (seat.cash < JAIL_FINE) {
        return { released: false, mustPay: true, roll, insolvent: true };
      }
      seat.cash -= JAIL_FINE;
      seat.inJail = false;
      seat.jailTurns = 0;
      return { released: true, mustPay: true, roll };
    }
    return { released: false, roll };
  }

  return { error: 'UNKNOWN_STRATEGY' };
}
