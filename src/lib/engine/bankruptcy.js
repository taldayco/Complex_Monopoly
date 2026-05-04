import { BOARD } from '../shared/board.js';
import { ownedBy, activeSeats } from './selectors.js';

// When a player declares bankruptcy:
//   - If owed to another player: transfer all assets (cash, properties incl. mortgaged, jail-free cards).
//     Houses are sold back to bank at half cost first (rule simplification: liquidate buildings to bank).
//   - If owed to the bank (tax / repairs / unaffordable jail fine): properties returned to bank
//     (auctioned back; for simplicity in v1 we'll just return them mortgaged-or-not to unowned).

export function liquidateBuildings(state, seatIndex) {
  // Sells all houses/hotels back to bank at half cost. Used during bankruptcy.
  let totalRefund = 0;
  for (const idx of ownedBy(state, seatIndex)) {
    const space = BOARD[idx];
    const prop = state.properties[idx];
    if (prop.houses > 0 && space.houseCost) {
      const refund = Math.floor((space.houseCost * prop.houses) / 2);
      totalRefund += refund;
      // Return houses/hotels to bank.
      if (prop.houses === 5) {
        state.bank.hotelsAvailable += 1;
        // No need to return houses since hotel was 1 hotel
      } else {
        state.bank.housesAvailable += prop.houses;
      }
      prop.houses = 0;
    }
  }
  state.seats[seatIndex].cash += totalRefund;
  return totalRefund;
}

export function transferToCreditor(state, debtorSeat, creditorSeat) {
  liquidateBuildings(state, debtorSeat);
  const debtor = state.seats[debtorSeat];
  const creditor = state.seats[creditorSeat];

  creditor.cash += debtor.cash;
  debtor.cash = 0;

  for (const idx of ownedBy(state, debtorSeat)) {
    state.properties[idx].ownerSeat = creditorSeat;
    // Mortgaged status preserved; new owner pays 10% to unmortgage later.
  }
  if (debtor.getOutOfJailFreeChance) {
    creditor.getOutOfJailFreeChance = true;
    debtor.getOutOfJailFreeChance = false;
  }
  if (debtor.getOutOfJailFreeCommunity) {
    creditor.getOutOfJailFreeCommunity = true;
    debtor.getOutOfJailFreeCommunity = false;
  }
  debtor.bankrupt = true;
}

export function returnToBank(state, debtorSeat) {
  liquidateBuildings(state, debtorSeat);
  const debtor = state.seats[debtorSeat];
  for (const idx of ownedBy(state, debtorSeat)) {
    state.properties[idx].ownerSeat = null;
    state.properties[idx].mortgaged = false;
  }
  // Jail-free cards return to the bottom of their respective decks.
  if (debtor.getOutOfJailFreeChance) {
    state.chance.discard.push('CH08');
    debtor.getOutOfJailFreeChance = false;
  }
  if (debtor.getOutOfJailFreeCommunity) {
    state.communityChest.discard.push('CC05');
    debtor.getOutOfJailFreeCommunity = false;
  }
  debtor.cash = 0;
  debtor.bankrupt = true;
}

export function checkGameOver(state) {
  const remaining = activeSeats(state);
  if (remaining.length <= 1) {
    state.phase = 'finished';
    state.finishedAt = Date.now();
    state.winnerSeat = remaining[0]?.seat ?? null;
    return true;
  }
  return false;
}
