import { BOARD, isOwnable } from '../shared/board.js';

// Trade offer schema:
// { fromSeat, toSeat, offer: { cash, properties: [spaceIndex...], jailFreeChance, jailFreeCommunity },
//   request: same shape }

export function validateTrade(state, trade) {
  const a = state.seats[trade.fromSeat];
  const b = state.seats[trade.toSeat];
  if (!a || !b) return { ok: false, error: 'BAD_SEAT' };
  if (a.bankrupt || b.bankrupt) return { ok: false, error: 'BANKRUPT' };
  const checkSide = (seat, side) => {
    if (side.cash < 0) return 'NEGATIVE_CASH';
    if (side.cash > 0 && seat.cash < side.cash) return 'INSUFFICIENT_FUNDS';
    for (const idx of side.properties ?? []) {
      const space = BOARD[idx];
      if (!space || !isOwnable(space)) return 'BAD_PROPERTY';
      const prop = state.properties[idx];
      if (prop.ownerSeat !== seat.seat) return 'NOT_OWNER';
      if (prop.houses > 0) return 'HAS_HOUSES';
    }
    if (side.jailFreeChance && !seat.getOutOfJailFreeChance) return 'NO_JAIL_CARD';
    if (side.jailFreeCommunity && !seat.getOutOfJailFreeCommunity) return 'NO_JAIL_CARD';
    return null;
  };
  const errA = checkSide(a, trade.offer);
  if (errA) return { ok: false, error: errA, side: 'offer' };
  const errB = checkSide(b, trade.request);
  if (errB) return { ok: false, error: errB, side: 'request' };
  return { ok: true };
}

export function executeTrade(state, trade) {
  const check = validateTrade(state, trade);
  if (!check.ok) return check;
  const a = state.seats[trade.fromSeat];
  const b = state.seats[trade.toSeat];

  // Atomic swap. Cash diff in one shot.
  const aGivesCash = trade.offer.cash ?? 0;
  const bGivesCash = trade.request.cash ?? 0;
  a.cash += bGivesCash - aGivesCash;
  b.cash += aGivesCash - bGivesCash;

  for (const idx of trade.offer.properties ?? []) {
    state.properties[idx].ownerSeat = b.seat;
  }
  for (const idx of trade.request.properties ?? []) {
    state.properties[idx].ownerSeat = a.seat;
  }

  if (trade.offer.jailFreeChance) {
    a.getOutOfJailFreeChance = false;
    b.getOutOfJailFreeChance = true;
  }
  if (trade.offer.jailFreeCommunity) {
    a.getOutOfJailFreeCommunity = false;
    b.getOutOfJailFreeCommunity = true;
  }
  if (trade.request.jailFreeChance) {
    b.getOutOfJailFreeChance = false;
    a.getOutOfJailFreeChance = true;
  }
  if (trade.request.jailFreeCommunity) {
    b.getOutOfJailFreeCommunity = false;
    a.getOutOfJailFreeCommunity = true;
  }

  return { ok: true };
}
