import { BOARD } from '../shared/board.js';
import { ownedBy, activeSeats } from './selectors.js';
import { BANKRUPTCY_FLOOR } from '../shared/reserve/loanCatalog.js';
import { VOLATILE_STOCK_ORDER, FP500_SYMBOL } from '../shared/reserve/stockCatalog.js';
import { sellShares } from './reserve/stocks.js';
import { inflatedPrice } from '../shared/economy/inflation.js';

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
      const refund = Math.round(inflatedPrice(state, space.houseCost) * prop.houses * 50) / 100;
      totalRefund = Math.round((totalRefund + refund) * 100) / 100;
      if (prop.houses === 5) {
        state.bank.hotelsAvailable += 1;
      } else {
        state.bank.housesAvailable += prop.houses;
      }
      prop.houses = 0;
    }
  }
  state.seats[seatIndex].cash = Math.round((state.seats[seatIndex].cash + totalRefund) * 100) / 100;
  return totalRefund;
}

export function transferToCreditor(state, debtorSeat, creditorSeat) {
  liquidateBuildings(state, debtorSeat);
  const debtor = state.seats[debtorSeat];
  const creditor = state.seats[creditorSeat];

  creditor.cash = Math.round((creditor.cash + debtor.cash) * 100) / 100;
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
  clearPendingsForSeat(state, debtorSeat);
}

function clearPendingsForSeat(state, debtorSeat) {
  if (Array.isArray(state.pendingTransfers)) {
    state.pendingTransfers = state.pendingTransfers.filter(
      (t) => t.fromSeat !== debtorSeat && t.toSeat !== debtorSeat
    );
  }
  if (state.pendingTrainTravel?.seat === debtorSeat) {
    state.pendingTrainTravel = null;
  }
  if (state.pendingJailSeizureChoice?.seat === debtorSeat) {
    state.pendingJailSeizureChoice = null;
  }
  if (state.pendingCardChoice?.seat === debtorSeat) {
    state.pendingCardChoice = null;
  }
  if (Array.isArray(state.pendingAuctions)) {
    state.pendingAuctions = state.pendingAuctions.filter(
      (a) => a.declinedBy !== debtorSeat
    );
  }
  const pa = state.pendingAction;
  if (pa) {
    if (pa.type === 'buyDecision' && pa.seat === debtorSeat) state.pendingAction = null;
    else if (pa.type === 'auction' && pa.highBidder === debtorSeat) {
      pa.highBidder = null;
      pa.currentBid = 0;
    }
    else if (pa.type === 'settleDebt' && pa.debtorSeat === debtorSeat) state.pendingAction = null;
    else if (pa.type === 'trade' && (pa.fromSeat === debtorSeat || pa.toSeat === debtorSeat)) state.pendingAction = null;
  }
}

function totalDebt(seat) {
  let debt = 0;
  for (const l of seat.loans ?? []) {
    if (l?.status === 'active' && typeof l.balance === 'number') debt += l.balance;
  }
  for (const l of seat.mortgageLoans ?? []) {
    if (l?.status === 'active' && typeof l.balance === 'number') debt += l.balance;
  }
  for (const c of seat.creditCards ?? []) {
    if (c?.status === 'active' && typeof c.balance === 'number') debt += c.balance;
  }
  return Math.round(debt * 100) / 100;
}

function liquidateStocks(state, seatIndex, debtRemaining) {
  const seat = state.seats[seatIndex];
  let proceeds = 0;
  const symbols = [...VOLATILE_STOCK_ORDER, FP500_SYMBOL];
  for (const sym of symbols) {
    if (debtRemaining - proceeds <= 0) break;
    const qty = seat.stockLots?.[sym] ?? 0;
    if (qty <= 0) continue;
    const r = sellShares(seat, state.stocks, sym, qty);
    if (r.ok) proceeds += r.proceeds ?? (qty * (state.stocks.market[sym]?.price ?? 0));
  }
  return proceeds;
}

function liquidateUndevelopedProperties(state, seatIndex, debtRemaining) {
  const seat = state.seats[seatIndex];
  let proceeds = 0;
  for (const idx of ownedBy(state, seatIndex)) {
    if (debtRemaining - proceeds <= 0) break;
    const prop = state.properties[idx];
    if (!prop || prop.houses > 0) continue;
    if (prop.mortgaged) continue;
    const space = BOARD[idx];
    const refund = space.mortgageValue ?? 0;
    prop.ownerSeat = null;
    prop.mortgaged = false;
    seat.cash = Math.round((seat.cash + refund) * 100) / 100;
    proceeds += refund;
  }
  return proceeds;
}

function liquidateAllBuildingsForSeat(state, seatIndex) {
  let proceeds = 0;
  for (const idx of ownedBy(state, seatIndex)) {
    const space = BOARD[idx];
    const prop = state.properties[idx];
    if (prop.houses > 0 && space.houseCost) {
      const refund = Math.round(inflatedPrice(state, space.houseCost) * prop.houses * 50) / 100;
      proceeds = Math.round((proceeds + refund) * 100) / 100;
      if (prop.houses === 5) {
        state.bank.hotelsAvailable += 1;
      } else {
        state.bank.housesAvailable += prop.houses;
      }
      prop.houses = 0;
    }
  }
  state.seats[seatIndex].cash = Math.round((state.seats[seatIndex].cash + proceeds) * 100) / 100;
  return proceeds;
}

function forfeitMortgagedProperties(state, seatIndex) {
  const seat = state.seats[seatIndex];
  for (const idx of ownedBy(state, seatIndex)) {
    const prop = state.properties[idx];
    if (!prop?.mortgaged) continue;
    prop.ownerSeat = null;
    prop.mortgaged = false;
    prop.houses = 0;
  }
  if (Array.isArray(seat.mortgageLoans)) {
    for (const l of seat.mortgageLoans) {
      if (l?.status === 'active') l.status = 'forfeited';
    }
  }
}

function clearAllDebts(seat) {
  if (Array.isArray(seat.loans)) {
    for (const l of seat.loans) {
      if (l?.status === 'active') {
        l.status = 'closed';
        l.balance = 0;
      }
    }
  }
  if (Array.isArray(seat.mortgageLoans)) {
    for (const l of seat.mortgageLoans) {
      if (l?.status === 'active' || l?.status === 'forfeited') {
        l.status = 'closed';
        l.balance = 0;
      }
    }
  }
  if (Array.isArray(seat.creditCards)) {
    for (const c of seat.creditCards) {
      if (c?.status === 'active') {
        c.status = 'cancelled';
        c.balance = 0;
      }
    }
  }
}

export function checkAndExecuteCreditBankruptcy(state, seatIndex, ctx, log) {
  const seat = state.seats?.[seatIndex];
  if (!seat || seat.bankrupt) return null;
  if ((seat.creditScore ?? 720) >= BANKRUPTCY_FLOOR) return null;
  const debtBefore = totalDebt(seat);
  const events = { stocks: 0, undeveloped: 0, buildings: 0, forfeitedMortgages: 0 };
  if (debtBefore > 0) {
    events.stocks = liquidateStocks(state, seatIndex, debtBefore);
    let remaining = Math.max(0, debtBefore - events.stocks);
    if (remaining > 0) {
      events.undeveloped = liquidateUndevelopedProperties(state, seatIndex, remaining);
      remaining = Math.max(0, remaining - events.undeveloped);
    }
    if (remaining > 0) {
      events.buildings = liquidateAllBuildingsForSeat(state, seatIndex);
      remaining = Math.max(0, remaining - events.buildings);
    }
    if (remaining > 0) {
      forfeitMortgagedProperties(state, seatIndex);
      events.forfeitedMortgages = 1;
    }
  }
  const totalProceeds = events.stocks + events.undeveloped + events.buildings;
  const recovered = totalProceeds >= debtBefore;
  if (recovered) {
    clearAllDebts(seat);
    seat.creditScore = BANKRUPTCY_FLOOR;
    if (log) log('creditCollapseRecovered', seatIndex, { debt: debtBefore, ...events });
  } else {
    clearAllDebts(seat);
    returnToBank(state, seatIndex);
    if (log) log('creditCollapseEliminated', seatIndex, { debt: debtBefore, ...events });
    checkGameOver(state);
  }
  return { recovered, debtBefore, ...events };
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
