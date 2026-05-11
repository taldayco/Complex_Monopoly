// Landing-flow helpers. Everything that runs after the dice (or a "Move to X"
// card) places a token on a board space lives here:
//   - `resolveLanding` is the dispatcher for what happens on the landed space
//     (own / unowned / rent / draw card / go-to-jail / market-open).
//   - `applyCardEffect` resolves a drawn Chance / Community-Chest card; many
//     effects re-enter `resolveLanding` after moving the seat.
//   - `applyGoCardBonuses` adds card-driven bonuses on top of the engine-paid
//     GO_SALARY.
//   - `computeRentRebate` sums card-driven rent rebates the bank covers.
//   - `computeTrainTravelChoices` / `maybeQueueTrainTravel` set up the
//     pendingTrainTravel state when a railroad-owner lands on their own.
//
// These are split out of reducer.js so action modules (jail, turn, property)
// can call them without depending on the dispatcher.

import { BOARD } from '../shared/board.js';
import { GO_INDEX, COLOR_GROUPS, RAILROAD_INDICES } from '../shared/constants.js';
import { advancePosition, moveTo, rollDice as rollDiceFn } from './movement.js';
import { computeRent } from './rent.js';
import { sendToJailWithSeizure } from './jail.js';
import { drawCard, returnCardToDiscard } from './cards.js';
import { startMarketOpen } from './reserve/marketOpen.js';
import { applyFdicDisaster } from './reserve/banking.js';
import { inflatedPrice } from '../shared/economy/inflation.js';
import { cents } from '../shared/money.js';
import {
  getRailRebateFor,
  getUtilityRebateFor,
  getBaseRentRebateFor,
  getGenericRentRebateFor,
  getBlueGreenRentRebateFor,
  getGoBonusFor,
  getGoLandingBonusFor,
  getOtherLandingBonusFor
} from '../shared/reserve/cardCatalog.js';
import {
  nearestRailroadFrom,
  nearestUtilityFrom,
  totalHousesOwned,
  totalHotelsOwned
} from './selectors.js';
import { tryDebit } from './_helpers.js';

export function resolveLanding(state, seatIndex, ctx, log, opts = {}) {
  const seat = state.seats[seatIndex];
  const space = BOARD[seat.position];
  log('land', seatIndex, { spaceIndex: seat.position, name: space.name });

  switch (space.type) {
    case 'go':
    case 'jail':
    case 'freeParking':
      return;

    case 'goToJail': {
      const r = sendToJailWithSeizure(state, seatIndex);
      log('toJail', seatIndex, null);
      if (r.seizureRequired) log('jailSeizureRequired', seatIndex, { choices: r.choices });
      return;
    }

    case 'marketOpen': {
      if (state.pendingCardChoice) return;
      const mo = startMarketOpen(state, seatIndex, ctx, seat.position);
      log('marketOpenStart', seatIndex, {
        spaceIndex: seat.position,
        totalTicks: mo.totalTicks,
        startedAtMs: mo.startedAtMs,
        endsAtMs: mo.endsAtMs,
        nextTickAtMs: mo.nextTickAtMs
      });
      return;
    }

    case 'chance': {
      const { card, id } = drawCard(state, 'chance', ctx.rng);
      if (card) {
        log('drawCard', seatIndex, { deck: 'chance', id, text: card.text });
        applyCardEffect(state, seatIndex, ctx, log, card, id, 'chance', opts.diceTotal);
      }
      return;
    }

    case 'communityChest': {
      const { card, id } = drawCard(state, 'communityChest', ctx.rng);
      if (card) {
        log('drawCard', seatIndex, { deck: 'communityChest', id, text: card.text });
        applyCardEffect(state, seatIndex, ctx, log, card, id, 'communityChest', opts.diceTotal);
      }
      return;
    }

    case 'property':
    case 'railroad':
    case 'utility': {
      const prop = state.properties[seat.position];
      if (prop.ownerSeat == null) {
        const livePrice = inflatedPrice(state, space.price);
        if (seat.cash < livePrice) {
          state.pendingAuctions.push({
            spaceIndex: seat.position,
            declinedBy: seatIndex,
            reason: 'insufficientFunds'
          });
          log('auctionQueued', seatIndex, {
            spaceIndex: seat.position,
            reason: 'insufficientFunds'
          });
        } else {
          state.pendingAction = {
            type: 'buyDecision',
            seat: seatIndex,
            spaceIndex: seat.position,
            price: livePrice
          };
          log('offerBuy', seatIndex, { spaceIndex: seat.position, price: livePrice });
        }
      } else if (prop.ownerSeat === seatIndex) {
        if (space.type === 'railroad') {
          maybeQueueTrainTravel(state, seatIndex, seat.position, log);
        }
      } else {
        const ownerSeat = state.seats[prop.ownerSeat];
        const ownerJailed = !!ownerSeat.inJail;
        const ownerLandingBonus = getOtherLandingBonusFor(ownerSeat);
        if (ownerLandingBonus > 0 && !ownerJailed) {
          ownerSeat.cash = cents(ownerSeat.cash + ownerLandingBonus);
          log('cardLandingBonus', prop.ownerSeat, {
            spaceIndex: seat.position,
            amount: ownerLandingBonus,
            landerSeat: seatIndex
          });
        }
        const rent = computeRent(state, seat.position, opts.diceTotal ?? 0, { ...(opts.rentOpts ?? {}), landerSeat: seatIndex });
        if (rent > 0) {
          const rebate = computeRentRebate(state, seat, space, prop, seatIndex);
          const bankCovers = cents(rent * rebate);
          const playerOwes = cents(rent - bankCovers);
          log('rentDue', seatIndex, {
            creditor: ownerJailed ? null : prop.ownerSeat,
            ownerJailed,
            amount: rent,
            playerOwes,
            bankCovers,
            rebate
          });
          if (bankCovers > 0 && !ownerJailed) {
            ownerSeat.cash = cents(ownerSeat.cash + bankCovers);
          }
          if (playerOwes > 0) {
            const creditorSeat = ownerJailed ? null : prop.ownerSeat;
            tryDebit(state, seatIndex, playerOwes, { type: 'rent', creditorSeat }, log);
          }
        }
        if (space.type === 'railroad') {
          maybeQueueTrainTravel(state, seatIndex, seat.position, log);
        }
      }
      return;
    }
  }
}

// Sum of applicable card-driven rent rebate fractions for the debtor seat,
// capped at 1. The owner still receives full rent; the bank covers the
// rebated portion. baseRentRebate only applies when rent IS unimproved
// single rent (no houses, owner doesn't hold the full color group).
function computeRentRebate(state, seat, space, prop, seatIndex) {
  let total = getGenericRentRebateFor(seat);
  if (space.type === 'railroad') {
    total += getRailRebateFor(seat);
  } else if (space.type === 'utility') {
    total += getUtilityRebateFor(seat);
  } else if (space.type === 'property') {
    if (space.colorGroup === 'darkblue' || space.colorGroup === 'green') {
      total += getBlueGreenRentRebateFor(seat);
    }
    const isBaseRent =
      prop.houses === 0 &&
      !ownsAllInGroupForRebate(state, prop.ownerSeat, space.colorGroup);
    if (isBaseRent) {
      total += getBaseRentRebateFor(seat);
    }
  }
  return Math.min(1, Math.max(0, total));
}

function ownsAllInGroupForRebate(state, ownerSeat, group) {
  const indices = COLOR_GROUPS[group] ?? [];
  return indices.length > 0 && indices.every((i) => state.properties[i]?.ownerSeat === ownerSeat);
}

// Card-driven GO bonuses, applied immediately after the engine collects
// GO_SALARY. Only fires when salary was actually collected (`passedGo`).
// Landing on GO yields goLandingBonus; passing without landing yields goBonus.
export function applyGoCardBonuses(state, seatIndex, passedGo, log) {
  if (!passedGo) return;
  const seat = state.seats[seatIndex];
  if (seat.position === GO_INDEX) {
    const bonus = getGoLandingBonusFor(seat);
    if (bonus > 0) {
      seat.cash = cents(seat.cash + bonus);
      log('cardGoLandingBonus', seatIndex, { amount: bonus });
    }
  } else {
    const bonus = getGoBonusFor(seat);
    if (bonus > 0) {
      seat.cash = cents(seat.cash + bonus);
      log('cardGoBonus', seatIndex, { amount: bonus });
    }
  }
}

export function applyCardEffect(state, seatIndex, ctx, log, card, id, deckName, diceTotal) {
  const seat = state.seats[seatIndex];
  const e = card.effect;

  switch (e.kind) {
    case 'moveTo': {
      const r = moveTo(seat, e.target, { collectGoOnPass: !!e.collectGo });
      applyGoCardBonuses(state, seatIndex, r.passedGo, log);
      returnCardToDiscard(state, deckName, id);
      resolveLanding(state, seatIndex, ctx, log, { diceTotal });
      return;
    }
    case 'move': {
      // "Go back 3" — no GO collection.
      let r;
      if (e.steps < 0) {
        r = advancePosition(seat, e.steps, { collectGoOnPass: false });
      } else {
        r = advancePosition(seat, e.steps);
      }
      applyGoCardBonuses(state, seatIndex, r.passedGo, log);
      returnCardToDiscard(state, deckName, id);
      resolveLanding(state, seatIndex, ctx, log, { diceTotal });
      return;
    }
    case 'moveToNearestRailroad': {
      const target = nearestRailroadFrom(seat.position + 1);
      const r = moveTo(seat, target, { collectGoOnPass: true });
      applyGoCardBonuses(state, seatIndex, r.passedGo, log);
      returnCardToDiscard(state, deckName, id);
      // Special: if owned, pay 2x rent.
      resolveLanding(state, seatIndex, ctx, log, {
        diceTotal,
        rentOpts: { railroadMultiplier: 2 }
      });
      return;
    }
    case 'moveToNearestUtility': {
      const target = nearestUtilityFrom(seat.position + 1);
      const r = moveTo(seat, target, { collectGoOnPass: true });
      applyGoCardBonuses(state, seatIndex, r.passedGo, log);
      returnCardToDiscard(state, deckName, id);
      // Special: if owned, pay 10x dice (regardless of utilities owned). Roll fresh dice.
      const utilityRoll = rollDiceFn(ctx.rng);
      state.rngCursor++;
      state.turn.lastRoll = [utilityRoll.d1, utilityRoll.d2];
      log('utilityRoll', seatIndex, { d1: utilityRoll.d1, d2: utilityRoll.d2 });
      resolveLanding(state, seatIndex, ctx, log, {
        diceTotal: utilityRoll.total,
        rentOpts: { utilityMultiplier: 10 }
      });
      return;
    }
    case 'collect': {
      const amount = inflatedPrice(state, e.amount);
      seat.cash = cents(seat.cash + amount);
      log('collect', seatIndex, { amount, base: e.amount });
      returnCardToDiscard(state, deckName, id);
      return;
    }
    case 'pay': {
      const amount = inflatedPrice(state, e.amount);
      returnCardToDiscard(state, deckName, id);
      tryDebit(state, seatIndex, amount, { type: 'card', name: card.text }, log);
      return;
    }
    case 'payEachPlayer': {
      returnCardToDiscard(state, deckName, id);
      const others = state.seats.filter((s) => s.seat !== seatIndex && !s.bankrupt);
      const perPlayer = inflatedPrice(state, e.amount);
      const total = cents(perPlayer * others.length);
      if (seat.cash >= total) {
        seat.cash = cents(seat.cash - total);
        for (const o of others) o.cash = cents(o.cash + perPlayer);
        log('payEachPlayer', seatIndex, { amount: perPlayer, base: e.amount, others: others.length });
      } else {
        // Open settleDebt for the full chairman amount.
        state.pendingAction = {
          type: 'settleDebt',
          debtorSeat: seatIndex,
          creditor: { kind: 'bank' }, // simplification: treat as bank debt; payout happens on settle
          amount: total,
          source: { type: 'chairman', perPlayer, recipients: others.map((o) => o.seat) }
        };
        log('settleDebt', seatIndex, { amount: total, source: 'chairman' });
      }
      return;
    }
    case 'collectFromEachPlayer': {
      returnCardToDiscard(state, deckName, id);
      const others = state.seats.filter((s) => s.seat !== seatIndex && !s.bankrupt);
      const perPlayer = inflatedPrice(state, e.amount);
      for (const o of others) {
        const give = Math.min(o.cash, perPlayer);
        o.cash = cents(o.cash - give);
        seat.cash = cents(seat.cash + give);
      }
      log('collectFromEachPlayer', seatIndex, { amount: perPlayer, base: e.amount, others: others.length });
      return;
    }
    case 'goToJail': {
      const r = sendToJailWithSeizure(state, seatIndex);
      returnCardToDiscard(state, deckName, id);
      log('toJail', seatIndex, null);
      if (r.seizureRequired) log('jailSeizureRequired', seatIndex, { choices: r.choices });
      return;
    }
    case 'getOutOfJailFree': {
      // Card stays with player, NOT returned to discard.
      if (e.deck === 'chance') seat.getOutOfJailFreeChance = true;
      else if (e.deck === 'communityChest') seat.getOutOfJailFreeCommunity = true;
      log('getJailCard', seatIndex, { deck: e.deck });
      return;
    }
    case 'repairs': {
      const houses = totalHousesOwned(state, seatIndex);
      const hotels = totalHotelsOwned(state, seatIndex);
      const baseAmount = houses * e.perHouse + hotels * e.perHotel;
      const amount = inflatedPrice(state, baseAmount);
      returnCardToDiscard(state, deckName, id);
      if (amount === 0) return;
      tryDebit(state, seatIndex, amount, { type: 'repairs', name: card.text }, log);
      return;
    }
    case 'fdicDisaster': {
      returnCardToDiscard(state, deckName, id);
      const r = applyFdicDisaster(state.seats);
      log('fdicDisaster', seatIndex, {
        triggeringSeat: seatIndex,
        losses: r.losses
      });
      return;
    }
    default:
      returnCardToDiscard(state, deckName, id);
      return;
  }
}

// If a railroad lander has another player owning multiple railroads (or owns
// multiple themselves), the lander may travel to one of those siblings without
// rolling. computeTrainTravelChoices picks the eligible destinations.
function computeTrainTravelChoices(state, fromIdx) {
  const fromOwner = state.properties[fromIdx]?.ownerSeat;
  const ownersByIdx = new Map();
  let ownerWithMultiple = null;
  for (const idx of RAILROAD_INDICES) {
    const owner = state.properties[idx]?.ownerSeat;
    if (owner == null) continue;
    ownersByIdx.set(idx, owner);
    if (owner === fromOwner && idx !== fromIdx) {
      if (!ownerWithMultiple) ownerWithMultiple = fromOwner;
    }
  }
  if (ownerWithMultiple != null) {
    return RAILROAD_INDICES.filter((i) => i !== fromIdx && ownersByIdx.get(i) === ownerWithMultiple);
  }
  return RAILROAD_INDICES.filter((i) => i !== fromIdx && ownersByIdx.has(i));
}

export function maybeQueueTrainTravel(state, seatIndex, fromIdx, log) {
  const choices = computeTrainTravelChoices(state, fromIdx);
  if (choices.length === 0) return;
  state.pendingTrainTravel = { seat: seatIndex, fromIdx, choices };
  log('trainTravelOffered', seatIndex, { fromIdx, choices });
}
