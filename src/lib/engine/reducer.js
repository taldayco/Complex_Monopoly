import { BOARD, isOwnable } from '../shared/board.js';
import {
  GO_INDEX,
  GO_TO_JAIL_INDEX,
  JAIL_INDEX,
  GO_SALARY,
  MAX_DOUBLES,
  CHANCE_INDICES,
  COMMUNITY_CHEST_INDICES,
  BUY_MORTGAGE_PTR,
  BUY_MORTGAGE_TERMS,
  COLOR_GROUPS,
  RAILROAD_INDICES,
  BOARD_SIZE
} from '../shared/constants.js';
import { advancePosition, moveTo, rollDice as rollDiceFn } from './movement.js';
import { computeRent } from './rent.js';
import { canBuy, buyProperty as buyPropertyFn, transferOwnership } from './purchase.js';
import { sendToJail, sendToJailWithSeizure, seizePropertyToBank, attemptJailExit } from './jail.js';
import { drawCard, returnCardToDiscard } from './cards.js';
import { canBuyHouse, buyHouse as buyHouseFn, canSellHouse, sellHouse as sellHouseFn } from './building.js';
import {
  requestMortgageLoan as requestMortgageLoanFn,
  payMortgageInstallment as payMortgageInstallmentFn,
  skipMortgageInstallment as skipMortgageInstallmentFn,
  payoffMortgageLoan as payoffMortgageLoanFn,
  markMortgageLoansDueAtTurnStart,
  sellPropertyToBank as sellPropertyToBankFn
} from './mortgage.js';
import { validateTrade, executeTrade } from './trade.js';
import {
  createAuction,
  applyBid,
  shouldSettleEarly,
  isExpired,
  settle as settleAuctionFn,
  randomAssign as randomAssignAuctionFn,
  AUCTION_ATTEMPT_FRACTIONS
} from './auction.js';
import {
  flipMarket,
  buyShares,
  sellShares
} from './reserve/stocks.js';
import { flipEconomy, expireEconomyTempEffects } from './reserve/economy.js';
import {
  openAccount,
  closeAccount,
  deposit,
  withdraw,
  applyHysaInterestAtTurnStart,
  eligibleForBoardwalkDiscount,
  applyFdicDisaster
} from './reserve/banking.js';
import { BANKS } from '../shared/reserve/economyCatalog.js';
import { inflatedPrice } from '../shared/economy/inflation.js';
import { getTierByScore, effectiveTier, PTR_BY_TIER_AND_DICE, TERM_PREMIUM } from '../shared/reserve/loanCatalog.js';
import {
  rollLoanDie,
  requestLoanOffer,
  acceptLoanOffer,
  declineLoanOffer,
  payLoanInstallment,
  skipLoanInstallment,
  payoffLoan,
  markLoansDueAtTurnStart
} from './reserve/loans.js';
import {
  applyForCard,
  cancelCard,
  applyTurnStartCardFees,
  chargeCard,
  payCardBalance,
  accrueCardInterest,
  requestCreditLineIncrease
} from './reserve/cards.js';
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
  drawReserveCard,
  discardReserveCard,
  applyEventCard,
  decayTempEffects
} from './reserve/eventCards.js';
import {
  doWireTransfer,
  createTransferRequest,
  respondTransferRequest,
  cancelTransferRequest
} from './reserve/transfers.js';
import {
  startMarketOpen,
  applyMarketOpenTick,
  MARKET_OPEN_ALLOWED_ACTIONS
} from './reserve/marketOpen.js';
import {
  liquidateBuildings,
  transferToCreditor,
  returnToBank,
  checkGameOver,
  checkAndExecuteCreditBankruptcy
} from './bankruptcy.js';
import {
  ownedBy,
  totalHousesOwned,
  totalHotelsOwned,
  nearestRailroadFrom,
  nearestUtilityFrom,
  activeSeats,
  nextActiveSeatAfter
} from './selectors.js';
import { advanceTurn, startNewTurn } from './turn.js';

// Main reducer. Pure (deep-clones state). Accepts:
//   state — current room state
//   action — { type, seat?, ...payload }
//   ctx — { rng: () => float in [0,1) }
// Returns:
//   { ok: true, state, events } on success
//   { ok: false, error: string }
export function reducer(state, action, ctx) {
  if (state.phase === 'rollOff') {
    if (action.type !== 'rollForOrder') return { ok: false, error: 'NOT_PLAYING' };
    const next = structuredClone(state);
    const events = [];
    const log = (type, seat, payload) =>
      events.push({ ts: Date.now(), seat: seat ?? null, type, payload: payload ?? null });
    const result = doRollForOrder(next, action, ctx, log);
    if (result.error) return { ok: false, error: result.error };
    next.log.push(...events);
    next.updatedAt = Date.now();
    return { ok: true, state: next, events };
  }
  if (state.phase !== 'playing') {
    return { ok: false, error: 'NOT_PLAYING' };
  }
  const next = structuredClone(state);
  const events = [];
  const log = (type, seat, payload) =>
    events.push({ ts: Date.now(), seat: seat ?? null, type, payload: payload ?? null });

  const result = dispatch(next, action, ctx, log);
  if (result.error) return { ok: false, error: result.error };

  if (Array.isArray(next.seats)) {
    for (let i = 0; i < next.seats.length; i++) {
      checkAndExecuteCreditBankruptcy(next, i, ctx, log);
    }
  }

  if (
    next.phase === 'playing' &&
    next.turn &&
    next.seats?.[next.turn.seat]?.bankrupt
  ) {
    advanceTurn(next);
    log('turnAdvancedAfterBankruptcy', next.turn.seat, null);
  }

  next.log.push(...events);
  next.updatedAt = Date.now();
  return { ok: true, state: next, events };
}

const JAIL_BLOCKED_ACTIONS = new Set([
  'buyStock',
  'buyStockWithCard',
  'sellStock',
  'requestLoan',
  'respondLoanOffer',
  'payLoanInstallment',
  'skipLoanInstallment',
  'payoffLoan',
  'requestCreditCard',
  'requestCreditLineIncrease',
  'cancelCreditCard',
  'payCardBalance',
  'requestMortgageLoan',
  'payMortgageInstallment',
  'skipMortgageInstallment',
  'payoffMortgageLoan',
  'sellPropertyToBank',
  'openBankAccount',
  'closeBankAccount',
  'depositToBank',
  'withdrawFromBank',
  'wireTransfer',
  'requestTransfer',
  'respondTransfer',
  'cancelTransfer',
  'buyHouse',
  'sellHouse',
  'buyProperty',
  'buyPropertyWithMortgage',
  'buyPropertyWithCard',
  'proposeTrade',
  'respondTrade',
  'cancelTrade'
]);

function dispatch(state, action, ctx, log) {
  if (state.marketOpen?.active && !MARKET_OPEN_ALLOWED_ACTIONS.has(action.type)) {
    return { error: 'MARKET_OPEN_ACTIVE' };
  }
  if (
    typeof action.seat === 'number' &&
    state.seats?.[action.seat]?.inJail &&
    JAIL_BLOCKED_ACTIONS.has(action.type)
  ) {
    return { error: 'JAILED' };
  }
  switch (action.type) {
    case 'rollDice':         return doRollDice(state, action, ctx, log);
    case 'buyProperty':      return doBuyProperty(state, action, ctx, log);
    case 'buyPropertyWithMortgage': return doBuyPropertyWithMortgage(state, action, ctx, log);
    case 'buyPropertyWithCard': return doBuyPropertyWithCard(state, action, ctx, log);
    case 'declineToBuy':     return doDeclineToBuy(state, action, ctx, log);
    case 'bid':              return doBid(state, action, ctx, log);
    case 'auctionTick':      return doAuctionTick(state, action, ctx, log);
    case 'marketOpenTick':   return doMarketOpenTick(state, action, ctx, log);
    case 'buyStock':         return doBuyStock(state, action, ctx, log);
    case 'buyStockWithCard': return doBuyStockWithCard(state, action, ctx, log);
    case 'payCardBalance':   return doPayCardBalance(state, action, ctx, log);
    case 'sellStock':        return doSellStock(state, action, ctx, log);
    case 'requestLoan':      return doRequestLoan(state, action, ctx, log);
    case 'respondLoanOffer': return doRespondLoanOffer(state, action, ctx, log);
    case 'payLoanInstallment': return doPayLoanInstallment(state, action, ctx, log);
    case 'skipLoanInstallment': return doSkipLoanInstallment(state, action, ctx, log);
    case 'payoffLoan':       return doPayoffLoan(state, action, ctx, log);
    case 'requestCreditCard': return doRequestCreditCard(state, action, ctx, log);
    case 'requestCreditLineIncrease': return doRequestCreditLineIncrease(state, action, ctx, log);
    case 'cancelCreditCard': return doCancelCreditCard(state, action, ctx, log);
    case 'dismissEventCard': return doDismissEventCard(state, action, ctx, log);
    case 'wireTransfer':     return doWireAction(state, action, ctx, log);
    case 'requestTransfer':  return doRequestTransferAction(state, action, ctx, log);
    case 'respondTransfer':  return doRespondTransferAction(state, action, ctx, log);
    case 'cancelTransfer':   return doCancelTransferAction(state, action, ctx, log);
    case 'openBankAccount':  return doOpenBankAccount(state, action, ctx, log);
    case 'closeBankAccount': return doCloseBankAccount(state, action, ctx, log);
    case 'depositToBank':    return doDepositToBank(state, action, ctx, log);
    case 'withdrawFromBank': return doWithdrawFromBank(state, action, ctx, log);
    case 'requestMortgageLoan': return doRequestMortgageLoan(state, action, ctx, log);
    case 'payMortgageInstallment': return doPayMortgageInstallment(state, action, ctx, log);
    case 'skipMortgageInstallment': return doSkipMortgageInstallment(state, action, ctx, log);
    case 'payoffMortgageLoan': return doPayoffMortgageLoan(state, action, ctx, log);
    case 'sellPropertyToBank': return doSellPropertyToBank(state, action, ctx, log);
    case 'buyHouse':         return doBuyHouse(state, action, ctx, log);
    case 'sellHouse':        return doSellHouse(state, action, ctx, log);
    case 'proposeTrade':     return doProposeTrade(state, action, ctx, log);
    case 'respondTrade':     return doRespondTrade(state, action, ctx, log);
    case 'cancelTrade':      return doCancelTrade(state, action, ctx, log);
    case 'useGetOutOfJail':  return doUseGetOutOfJail(state, action, ctx, log);
    case 'payJailFine':      return doPayJailFine(state, action, ctx, log);
    case 'rollForJail':      return doRollForJail(state, action, ctx, log);
    case 'chooseJailSeizure': return doChooseJailSeizure(state, action, ctx, log);
    case 'chooseTrainDestination': return doChooseTrainDestination(state, action, ctx, log);
    case 'skipTrainTravel':  return doSkipTrainTravel(state, action, ctx, log);
    case 'chooseStockTarget': return doChooseStockTarget(state, action, ctx, log);
    case 'chooseLoanTarget': return doChooseLoanTarget(state, action, ctx, log);
    case 'skipCardChoice':   return doSkipCardChoice(state, action, ctx, log);
    case 'declareBankruptcy':return doDeclareBankruptcy(state, action, ctx, log);
    case 'endTurn':          return doEndTurn(state, action, ctx, log);
    case 'skipPlayer':       return doSkipPlayer(state, action, ctx, log);
    default:                 return { error: 'UNKNOWN_ACTION' };
  }
}

function isCurrentSeat(state, action) {
  return action.seat === state.turn.seat;
}

// When a stock's deck reshuffles, its wildcards are re-randomized. Any
// insider-tip reveals on the prior wildcards are now stale and must be
// dropped from every seat that knew them. The reveal is symbol-scoped, so
// reveals for un-reshuffled stocks are left intact.
function clearStaleWildcardReveals(state, reshuffledSymbols) {
  if (!Array.isArray(reshuffledSymbols) || reshuffledSymbols.length === 0) return;
  if (!Array.isArray(state.seats)) return;
  for (const sym of reshuffledSymbols) {
    for (const s of state.seats) {
      if (s?.revealedWildcards && s.revealedWildcards[sym] !== undefined) {
        delete s.revealedWildcards[sym];
      }
    }
  }
}

function doRollForOrder(state, action, ctx, log) {
  if (!state.rollOff) return { error: 'NO_ROLLOFF' };
  if (typeof action.seat !== 'number') return { error: 'NO_SEAT' };
  const ro = state.rollOff;
  if (!ro.contenders.includes(action.seat)) return { error: 'NOT_CONTENDER' };
  if (ro.rolls[action.seat] != null) return { error: 'ALREADY_ROLLED' };

  const roll = rollDiceFn(ctx.rng);
  state.rngCursor++;
  ro.rolls[action.seat] = { d1: roll.d1, d2: roll.d2, total: roll.total };
  log('rollForOrder', action.seat, { d1: roll.d1, d2: roll.d2, total: roll.total, round: ro.round });

  const allRolled = ro.contenders.every((s) => ro.rolls[s] != null);
  if (!allRolled) return {};

  const maxTotal = Math.max(...ro.contenders.map((s) => ro.rolls[s].total));
  const leaders = ro.contenders.filter((s) => ro.rolls[s].total === maxTotal);

  if (leaders.length > 1) {
    ro.contenders = leaders;
    ro.rolls = {};
    ro.round += 1;
    log('rollOffTieReroll', null, { contenders: leaders, total: maxTotal, round: ro.round });
    return {};
  }

  finalizeRollOff(state, leaders[0], maxTotal, log);
  return {};
}

function finalizeRollOff(state, winnerSeat, winnerTotal, log) {
  const lobbyOrder = state.seats.map((s) => s.seat);
  const winnerPos = lobbyOrder.indexOf(winnerSeat);
  const rotated = [...lobbyOrder.slice(winnerPos), ...lobbyOrder.slice(0, winnerPos)];

  const oldSeatsByIdx = new Map(state.seats.map((s) => [s.seat, s]));
  state.seats = rotated.map((oldIdx, newIdx) => ({
    ...oldSeatsByIdx.get(oldIdx),
    seat: newIdx
  }));
  state.phase = 'playing';
  state.turn = { seat: 0, phase: 'preRoll', lastRoll: null, lastRollWasDoubles: false, doublesCount: 0 };
  log('rollOffComplete', null, {
    winnerOriginalSeat: winnerSeat,
    winnerTotal,
    order: state.seats.map((s) => ({ seat: s.seat, name: s.name, token: s.playerToken }))
  });
  state.rollOff = null;
}

// ---------- ROLL DICE ----------
function doRollDice(state, action, ctx, log) {
  if (!isCurrentSeat(state, action)) return { error: 'NOT_YOUR_TURN' };
  if (state.turn.phase !== 'preRoll') return { error: 'BAD_PHASE' };
  if (state.pendingAction) return { error: 'BLOCKED_BY_PENDING' };
  if (state.pendingTrainTravel) return { error: 'BLOCKED_BY_TRAIN_TRAVEL' };
  if (state.pendingJailSeizureChoice) return { error: 'BLOCKED_BY_JAIL_SEIZURE' };
  if (state.pendingCardChoice) return { error: 'BLOCKED_BY_CARD_CHOICE' };
  const seat = state.seats[action.seat];
  if (seat.bankrupt) return { error: 'BANKRUPT' };
  if (seat.inJail) return { error: 'IN_JAIL' };
  if (seat.loanTurnResponded === false) return { error: 'LOAN_DUE' };
  if (seat.mortgageTurnResponded === false) return { error: 'MORTGAGE_DUE' };

  const roll = rollDiceFn(ctx.rng);
  state.rngCursor++;
  state.turn.lastRoll = [roll.d1, roll.d2];
  state.turn.lastRollWasDoubles = roll.doubles;

  if (roll.doubles) {
    state.turn.doublesCount++;
    if (state.turn.doublesCount >= MAX_DOUBLES) {
      const sj = sendToJailWithSeizure(state, action.seat);
      log('rollDice', action.seat, { d1: roll.d1, d2: roll.d2, doubles: true });
      log('threeDoubles', action.seat, null);
      log('toJail', action.seat, null);
      if (sj.seizureRequired) log('jailSeizureRequired', action.seat, { choices: sj.choices });
      state.turn.phase = 'endable';
      return {};
    }
  } else {
    // Reset doubles count is only on non-doubles already 0; but keep symmetric.
  }

  log('rollDice', action.seat, { d1: roll.d1, d2: roll.d2, doubles: roll.doubles });

  const { passedGo } = advancePosition(seat, roll.total);
  if (passedGo) log('passGo', action.seat, { amount: GO_SALARY });
  applyGoCardBonuses(state, action.seat, passedGo, log);

  resolveLanding(state, action.seat, ctx, log, { diceTotal: roll.total });
  finalizeTurnPhase(state, roll.doubles);
  return {};
}

// ---------- LANDING ----------
function resolveLanding(state, seatIndex, ctx, log, opts = {}) {
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

    case 'tax': {
      // Retained as defensive dead code: the classic Income/Luxury Tax tiles
      // are now `marketOpen`, but a future board variant could reintroduce
      // tax tiles and this arm stays correct.
      const amount = space.amount;
      tryDebit(state, seatIndex, amount, { type: 'tax', name: space.name }, log);
      return;
    }

    case 'marketOpen': {
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
      autoDrawReserveCard(state, seatIndex, 'chance', ctx, log);
      return;
    }

    case 'communityChest': {
      const { card, id } = drawCard(state, 'communityChest', ctx.rng);
      if (card) {
        log('drawCard', seatIndex, { deck: 'communityChest', id, text: card.text });
        applyCardEffect(state, seatIndex, ctx, log, card, id, 'communityChest', opts.diceTotal);
      }
      autoDrawReserveCard(state, seatIndex, 'community', ctx, log);
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
          ownerSeat.cash = Math.round((ownerSeat.cash + ownerLandingBonus) * 100) / 100;
          log('cardLandingBonus', prop.ownerSeat, {
            spaceIndex: seat.position,
            amount: ownerLandingBonus,
            landerSeat: seatIndex
          });
        }
        const rent = computeRent(state, seat.position, opts.diceTotal ?? 0, { ...(opts.rentOpts ?? {}), landerSeat: seatIndex });
        if (rent > 0) {
          const rebate = computeRentRebate(state, seat, space, prop, seatIndex);
          const bankCovers = Math.round(rent * rebate * 100) / 100;
          const playerOwes = Math.round((rent - bankCovers) * 100) / 100;
          log('rentDue', seatIndex, {
            creditor: ownerJailed ? null : prop.ownerSeat,
            ownerJailed,
            amount: rent,
            playerOwes,
            bankCovers,
            rebate
          });
          if (bankCovers > 0 && !ownerJailed) {
            ownerSeat.cash = Math.round((ownerSeat.cash + bankCovers) * 100) / 100;
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
function applyGoCardBonuses(state, seatIndex, passedGo, log) {
  if (!passedGo) return;
  const seat = state.seats[seatIndex];
  if (seat.position === GO_INDEX) {
    const bonus = getGoLandingBonusFor(seat);
    if (bonus > 0) {
      seat.cash = Math.round((seat.cash + bonus) * 100) / 100;
      log('cardGoLandingBonus', seatIndex, { amount: bonus });
    }
  } else {
    const bonus = getGoBonusFor(seat);
    if (bonus > 0) {
      seat.cash = Math.round((seat.cash + bonus) * 100) / 100;
      log('cardGoBonus', seatIndex, { amount: bonus });
    }
  }
}

// ---------- DEBT ----------
// Pay `amount` from debtor to creditor. If debtor can't pay, open settleDebt pendingAction.
function tryDebit(state, debtorSeat, amount, source, log) {
  const debtor = state.seats[debtorSeat];
  if (debtor.cash >= amount) {
    debtor.cash = Math.round((debtor.cash - amount) * 100) / 100;
    if (source.type === 'rent' && typeof source.creditorSeat === 'number') {
      const c = state.seats[source.creditorSeat];
      c.cash = Math.round((c.cash + amount) * 100) / 100;
    }
    log('pay', debtorSeat, { amount, source });
    return true;
  }
  const creditor = source.type === 'rent' && typeof source.creditorSeat === 'number'
    ? { kind: 'player', seat: source.creditorSeat }
    : { kind: 'bank' };
  state.pendingAction = {
    type: 'settleDebt',
    debtorSeat,
    creditor,
    amount,
    source
  };
  log('settleDebt', debtorSeat, { amount, source });
  return false;
}

function tryAutoSettle(state, log) {
  const pa = state.pendingAction;
  if (!pa || pa.type !== 'settleDebt') return;
  const debtor = state.seats[pa.debtorSeat];
  if (debtor.cash < pa.amount) return;
  debtor.cash = Math.round((debtor.cash - pa.amount) * 100) / 100;
  if (pa.creditor.kind === 'player') {
    const c = state.seats[pa.creditor.seat];
    c.cash = Math.round((c.cash + pa.amount) * 100) / 100;
  } else if (pa.source?.type === 'chairman') {
    for (const r of pa.source.recipients) {
      const recipient = state.seats[r];
      recipient.cash = Math.round((recipient.cash + pa.source.perPlayer) * 100) / 100;
    }
  }
  log('debtSettled', pa.debtorSeat, { amount: pa.amount, creditor: pa.creditor });
  state.pendingAction = null;
  recomputePhase(state);
}

// ---------- CARDS ----------
function applyCardEffect(state, seatIndex, ctx, log, card, id, deckName, diceTotal) {
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
      seat.cash = Math.round((seat.cash + amount) * 100) / 100;
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
      const total = Math.round(perPlayer * others.length * 100) / 100;
      if (seat.cash >= total) {
        seat.cash = Math.round((seat.cash - total) * 100) / 100;
        for (const o of others) o.cash = Math.round((o.cash + perPlayer) * 100) / 100;
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
        o.cash = Math.round((o.cash - give) * 100) / 100;
        seat.cash = Math.round((seat.cash + give) * 100) / 100;
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

// ---------- BUY / DECLINE ----------
function doBuyProperty(state, action, ctx, log) {
  const pa = state.pendingAction;
  if (!pa || pa.type !== 'buyDecision') return { error: 'NO_BUY_DECISION' };
  if (pa.seat !== action.seat) return { error: 'NOT_YOUR_DECISION' };
  const result = buyPropertyFn(state, action.seat, pa.spaceIndex);
  if (!result.ok) return { error: result.error };
  log('buy', action.seat, { spaceIndex: pa.spaceIndex, price: result.price });
  state.pendingAction = null;
  recomputePhase(state);
  return {};
}

function doDeclineToBuy(state, action, ctx, log) {
  const pa = state.pendingAction;
  if (!pa || pa.type !== 'buyDecision') return { error: 'NO_BUY_DECISION' };
  if (pa.seat !== action.seat) return { error: 'NOT_YOUR_DECISION' };
  state.pendingAuctions.push({
    spaceIndex: pa.spaceIndex,
    declinedBy: action.seat,
    reason: 'declined'
  });
  state.pendingAction = null;
  log('auctionQueued', action.seat, { spaceIndex: pa.spaceIndex, reason: 'declined' });
  recomputePhase(state);
  return {};
}

// Finance the property purchase as a 5- or 10-installment mortgage at fixed
// 10% per-turn interest. Property transfers immediately; the debt rides on
// the existing loan plumbing as a `seat.loans[]` entry tagged source: 'mortgage'.
function doBuyPropertyWithMortgage(state, action, ctx, log) {
  const pa = state.pendingAction;
  if (!pa || pa.type !== 'buyDecision') return { error: 'NO_BUY_DECISION' };
  if (pa.seat !== action.seat) return { error: 'NOT_YOUR_DECISION' };
  if (typeof action.spaceIndex === 'number' && action.spaceIndex !== pa.spaceIndex) {
    return { error: 'SPACE_MISMATCH' };
  }
  const term = action.term;
  if (!BUY_MORTGAGE_TERMS.includes(term)) return { error: 'BAD_TERM' };
  const seat = state.seats[action.seat];
  if (seat.bankrupt) return { error: 'BANKRUPT' };
  if (getTierByScore(seat.creditScore ?? 0).name === 'Poor') {
    return { error: 'NOT_ELIGIBLE' };
  }

  const result = transferOwnership(state, action.seat, pa.spaceIndex);
  if (!result.ok) return { error: result.error };
  const { price } = result;

  const principal = price;
  const ptr = BUY_MORTGAGE_PTR;
  const totalDebt = Math.round(principal * (1 + ptr * term) * 100) / 100;
  const installment = Math.round((totalDebt / term) * 100) / 100;
  const loan = {
    id: `M-${seat.seat}-${seat.loans.length}-${Date.now()}`,
    principal,
    term,
    ptr,
    totalDebt,
    installment,
    paymentsMade: 0,
    balance: totalDebt,
    takenAt: Date.now(),
    dueThisTurn: false,
    status: 'active',
    source: 'mortgage',
    propertyIndex: pa.spaceIndex,
    propertyName: BOARD[pa.spaceIndex].name
  };
  seat.loans.push(loan);

  log('buyWithMortgage', action.seat, {
    spaceIndex: pa.spaceIndex,
    price,
    term,
    ptr,
    totalDebt,
    installment,
    loanId: loan.id
  });
  state.pendingAction = null;
  recomputePhase(state);
  return {};
}

// Charge a property purchase to a specific credit card. Property transfers
// immediately; the price lands on the card balance and accrues interest at
// the card's catalog rate every 4-turn cycle. Per-card minLine caps the
// charge — a too-large purchase rejects with INSUFFICIENT_CREDIT before any
// state mutation, so partial-failure rollback is unnecessary.
function doBuyPropertyWithCard(state, action, ctx, log) {
  const pa = state.pendingAction;
  if (!pa || pa.type !== 'buyDecision') return { error: 'NO_BUY_DECISION' };
  if (pa.seat !== action.seat) return { error: 'NOT_YOUR_DECISION' };
  if (typeof action.spaceIndex === 'number' && action.spaceIndex !== pa.spaceIndex) {
    return { error: 'SPACE_MISMATCH' };
  }
  const seat = state.seats[action.seat];
  if (seat.bankrupt) return { error: 'BANKRUPT' };
  const charge = chargeCard(seat, action.instanceId, pa.price);
  if (!charge.ok) return { error: charge.error };
  const result = transferOwnership(state, action.seat, pa.spaceIndex);
  if (!result.ok) {
    // Rollback the optimistic charge so a transferOwnership rejection (e.g.
    // racing OWNED) doesn't leave the player charged for nothing.
    const inst = seat.creditCards.find((c) => c.id === action.instanceId);
    if (inst) inst.balance = Math.round(((inst.balance ?? 0) - pa.price) * 100) / 100;
    return { error: result.error };
  }
  log('buyWithCard', action.seat, {
    spaceIndex: pa.spaceIndex,
    price: pa.price,
    instanceId: action.instanceId,
    cardBalance: charge.balance,
    creditLine: charge.limit
  });
  state.pendingAction = null;
  recomputePhase(state);
  return {};
}

// ---------- AUCTION ----------
// Free-for-all bidding. Any non-bankrupt seat may bid; each accepted bid resets
// the timer. Settled by `doAuctionTick` (server-injected on timer expiry) or
// early when only one seat can still afford to outbid.
function doBid(state, action, ctx, log) {
  const pa = state.pendingAction;
  if (!pa || pa.type !== 'auction') return { error: 'NO_AUCTION' };
  const r = applyBid(state, pa, action.seat, action.amount);
  if (!r.ok) return { error: r.error };
  log('bid', action.seat, { amount: pa.currentBid, endsAtMs: pa.endsAtMs });
  if (shouldSettleEarly(state, pa)) {
    finalizeAuction(state, ctx, log);
  }
  return {};
}

// Server-injected only — fires when the auction window expires.
function doAuctionTick(state, action, ctx, log) {
  if (!action._server) return { error: 'CLIENT_TICK' };
  const pa = state.pendingAction;
  if (!pa || pa.type !== 'auction') return { error: 'NO_AUCTION' };
  if (!isExpired(pa)) return { error: 'NOT_EXPIRED' };
  finalizeAuction(state, ctx, log);
  return {};
}

function finalizeAuction(state, ctx, log) {
  const pa = state.pendingAction;
  if (pa.currentBid === 0) {
    const nextAttempt = (pa.attempt ?? 0) + 1;
    if (nextAttempt < AUCTION_ATTEMPT_FRACTIONS.length) {
      const auction = createAuction(pa.spaceIndex, nextAttempt);
      state.pendingAction = auction;
      log('auctionStart', null, {
        spaceIndex: pa.spaceIndex,
        attempt: nextAttempt,
        startPrice: auction.startPrice,
        endsAtMs: auction.endsAtMs,
        reason: 'cascadeNoBid'
      });
      return;
    }
    const r = randomAssignAuctionFn(state, pa.spaceIndex, ctx?.rng);
    log('auctionEnd', null, {
      spaceIndex: pa.spaceIndex,
      soldTo: r.soldTo,
      price: 0,
      randomized: true
    });
    state.pendingAction = null;
    continueEndTurnFlow(state, ctx, log);
    return;
  }
  const result = settleAuctionFn(state, pa);
  log('auctionEnd', null, {
    spaceIndex: pa.spaceIndex,
    soldTo: result.soldTo,
    price: result.price
  });
  state.pendingAction = null;
  // Continue the deferred end-turn flow: either start the next queued auction
  // or finally advance the turn.
  continueEndTurnFlow(state, ctx, log);
}

function doRequestMortgageLoan(state, action, ctx, log) {
  const reserveRate = state.economy?.reserveRate ?? 0;
  const r = requestMortgageLoanFn(
    state,
    action.seat,
    action.spaceIndex,
    action.term,
    action.downPaymentPct ?? 0,
    { reserveRate }
  );
  if (!r.ok) return { error: r.error };
  log('mortgageLoanIssued', action.seat, {
    spaceIndex: action.spaceIndex,
    loanId: r.loan.id,
    principal: r.loan.principal,
    term: r.loan.term,
    ptr: r.loan.ptr,
    downPaymentPct: r.loan.downPaymentPct
  });
  return {};
}

function doPayMortgageInstallment(state, action, ctx, log) {
  const r = payMortgageInstallmentFn(state, action.seat, action.loanId);
  if (!r.ok) return { error: r.error };
  log('mortgageInstallmentPaid', action.seat, {
    loanId: action.loanId,
    paid: r.paid,
    balance: r.loan.balance,
    closed: r.loan.status === 'closed'
  });
  return {};
}

function doSkipMortgageInstallment(state, action, ctx, log) {
  const r = skipMortgageInstallmentFn(state, action.seat, action.loanId);
  if (!r.ok) return { error: r.error };
  log('mortgageInstallmentSkipped', action.seat, { loanId: action.loanId });
  return {};
}

function doPayoffMortgageLoan(state, action, ctx, log) {
  const r = payoffMortgageLoanFn(state, action.seat, action.loanId);
  if (!r.ok) return { error: r.error };
  log('mortgageLoanPaidOff', action.seat, { loanId: action.loanId, paid: r.paid });
  return {};
}

function doSellPropertyToBank(state, action, ctx, log) {
  const r = sellPropertyToBankFn(state, action.seat, action.spaceIndex);
  if (!r.ok) return { error: r.error };
  log('sellPropertyToBank', action.seat, { spaceIndex: action.spaceIndex, payout: r.payout });
  tryAutoSettle(state, log);
  return {};
}

function doBuyHouse(state, action, ctx, log) {
  // Cannot build during a pending action (settleDebt allows selling, not buying).
  if (state.pendingAction && state.pendingAction.type !== 'trade') {
    return { error: 'BLOCKED_BY_PENDING' };
  }
  const r = buyHouseFn(state, action.seat, action.spaceIndex);
  if (!r.ok) return { error: r.error };
  log('buyHouse', action.seat, { spaceIndex: action.spaceIndex, houses: r.houses, cost: r.cost });
  return {};
}

function doSellHouse(state, action, ctx, log) {
  const r = sellHouseFn(state, action.seat, action.spaceIndex);
  if (!r.ok) return { error: r.error };
  log('sellHouse', action.seat, { spaceIndex: action.spaceIndex, houses: r.houses, refund: r.refund });
  tryAutoSettle(state, log);
  return {};
}

// ---------- TRADE ----------
function doProposeTrade(state, action, ctx, log) {
  if (state.pendingAction && state.pendingAction.type !== 'settleDebt') {
    return { error: 'BLOCKED_BY_PENDING' };
  }
  const trade = {
    fromSeat: action.seat,
    toSeat: action.toSeat,
    offer: action.offer ?? { cash: 0, properties: [] },
    request: action.request ?? { cash: 0, properties: [] }
  };
  const v = validateTrade(state, trade);
  if (!v.ok) return { error: v.error };
  // Pending trade is stored separately to not block turn flow entirely.
  state.pendingTrade = trade;
  log('tradeProposed', action.seat, { toSeat: trade.toSeat });
  return {};
}

function doRespondTrade(state, action, ctx, log) {
  const trade = state.pendingTrade;
  if (!trade) return { error: 'NO_TRADE' };
  if (trade.toSeat !== action.seat) return { error: 'NOT_YOU' };
  if (!action.accept) {
    state.pendingTrade = null;
    log('tradeDeclined', action.seat, null);
    return {};
  }
  const r = executeTrade(state, trade);
  if (!r.ok) {
    state.pendingTrade = null;
    return { error: r.error };
  }
  log('tradeExecuted', action.seat, {
    fromSeat: trade.fromSeat,
    toSeat: trade.toSeat,
    offer: trade.offer,
    request: trade.request
  });
  state.pendingTrade = null;
  tryAutoSettle(state, log);
  return {};
}

function doCancelTrade(state, action, ctx, log) {
  if (!state.pendingTrade) return { error: 'NO_TRADE' };
  if (state.pendingTrade.fromSeat !== action.seat) return { error: 'NOT_YOURS' };
  state.pendingTrade = null;
  log('tradeCancelled', action.seat, null);
  return {};
}

// ---------- JAIL ----------
function doUseGetOutOfJail(state, action, ctx, log) {
  if (!isCurrentSeat(state, action)) return { error: 'NOT_YOUR_TURN' };
  if (state.turn.phase !== 'preRoll') return { error: 'BAD_PHASE' };
  const seat = state.seats[action.seat];
  const r = attemptJailExit(state, seat, 'card', ctx.rng);
  if (r.error) return { error: r.error };
  log('jailFree', action.seat, { deck: r.returnedCard });
  if (r.returnedCard === 'chance') returnCardToDiscard(state, 'chance', 'CH08');
  if (r.returnedCard === 'communityChest') returnCardToDiscard(state, 'communityChest', 'CC05');
  return {};
}

function doPayJailFine(state, action, ctx, log) {
  if (!isCurrentSeat(state, action)) return { error: 'NOT_YOUR_TURN' };
  if (state.turn.phase !== 'preRoll') return { error: 'BAD_PHASE' };
  const seat = state.seats[action.seat];
  const r = attemptJailExit(state, seat, 'pay', ctx.rng);
  if (r.error) return { error: r.error };
  log('jailFinePaid', action.seat, null);
  return {};
}

function doRollForJail(state, action, ctx, log) {
  if (!isCurrentSeat(state, action)) return { error: 'NOT_YOUR_TURN' };
  if (state.turn.phase !== 'preRoll') return { error: 'BAD_PHASE' };
  const seat = state.seats[action.seat];
  const r = attemptJailExit(state, seat, 'roll', ctx.rng);
  if (r.error) return { error: r.error };
  state.rngCursor++;
  state.turn.lastRoll = [r.roll.d1, r.roll.d2];
  state.turn.lastRollWasDoubles = false;
  log('jailRoll', action.seat, { d1: r.roll.d1, d2: r.roll.d2, released: r.released });

  if (r.released) {
    // If they paid on the third turn (mustPay), don't grant doubles bonus turn.
    const { passedGo } = advancePosition(seat, r.roll.total);
    if (passedGo) log('passGo', action.seat, { amount: GO_SALARY });
    applyGoCardBonuses(state, action.seat, passedGo, log);
    resolveLanding(state, action.seat, ctx, log, { diceTotal: r.roll.total });
    state.turn.phase = state.pendingAction ? 'resolving' : 'endable';
  } else if (r.insolvent) {
    state.pendingAction = {
      type: 'settleDebt',
      debtorSeat: action.seat,
      creditor: { kind: 'bank' },
      amount: r.fine,
      source: { type: 'jailFine' }
    };
    state.turn.phase = 'resolving';
  } else {
    state.turn.phase = 'endable';
  }
  return {};
}

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

function maybeQueueTrainTravel(state, seatIndex, fromIdx, log) {
  const choices = computeTrainTravelChoices(state, fromIdx);
  if (choices.length === 0) return;
  state.pendingTrainTravel = { seat: seatIndex, fromIdx, choices };
  log('trainTravelOffered', seatIndex, { fromIdx, choices });
}

function doChooseTrainDestination(state, action, ctx, log) {
  const pending = state.pendingTrainTravel;
  if (!pending) return { error: 'NO_TRAIN_PENDING' };
  if (pending.seat !== action.seat) return { error: 'NOT_TRAVELER' };
  if (!pending.choices.includes(action.spaceIndex)) return { error: 'INVALID_CHOICE' };
  const seat = state.seats[action.seat];
  const from = pending.fromIdx;
  const to = action.spaceIndex;
  const passedGo = to < from;
  seat.position = to;
  if (passedGo) {
    seat.cash = Math.round((seat.cash + GO_SALARY) * 100) / 100;
    log('passGo', action.seat, { amount: GO_SALARY });
  }
  state.pendingTrainTravel = null;
  log('trainTraveled', action.seat, { fromIdx: from, toIdx: to, passedGo });
  return {};
}

function doSkipTrainTravel(state, action, ctx, log) {
  const pending = state.pendingTrainTravel;
  if (!pending) return { error: 'NO_TRAIN_PENDING' };
  if (pending.seat !== action.seat) return { error: 'NOT_TRAVELER' };
  state.pendingTrainTravel = null;
  log('trainTravelSkipped', action.seat, null);
  return {};
}

function doChooseJailSeizure(state, action, ctx, log) {
  const pending = state.pendingJailSeizureChoice;
  if (!pending) return { error: 'NO_SEIZURE_PENDING' };
  if (pending.seat !== action.seat) return { error: 'NOT_DEBTOR' };
  const idx = action.spaceIndex;
  if (!pending.choices.includes(idx)) return { error: 'INVALID_CHOICE' };
  const r = seizePropertyToBank(state, action.seat, idx);
  if (!r.ok) return { error: r.error };
  state.pendingJailSeizureChoice = null;
  log('jailSeized', action.seat, { spaceIndex: idx });
  return {};
}

function doChooseStockTarget(state, action, ctx, log) {
  const pending = state.pendingCardChoice;
  if (!pending) return { error: 'NO_CARD_CHOICE_PENDING' };
  if (pending.seat !== action.seat) return { error: 'NOT_TARGET' };
  if (pending.kind !== 'stockUpgrade' && pending.kind !== 'insiderTip') {
    return { error: 'WRONG_CHOICE_KIND' };
  }
  const sym = action.symbol;
  if (!pending.options.includes(sym)) return { error: 'INVALID_CHOICE' };
  const market = state.stocks?.market?.[sym];
  if (!market) return { error: 'UNKNOWN_STOCK' };
  if (pending.kind === 'stockUpgrade') {
    const factor = 1 + (typeof pending.amount === 'number' ? pending.amount : 0);
    market.price = Math.max(0.01, Math.round(market.price * factor * 100) / 100);
    if (!Array.isArray(market.history)) market.history = [];
    market.history.push(market.price);
    log('analystAdjustment', action.seat, { symbol: sym, amount: pending.amount, newPrice: market.price });
  } else {
    const seat = state.seats[action.seat];
    const nextCard = market.deck?.[0];
    if (nextCard != null) {
      if (!seat.revealedWildcards) seat.revealedWildcards = {};
      seat.revealedWildcards[sym] = nextCard;
      log('insiderTipRevealed', action.seat, { symbol: sym });
    }
  }
  state.pendingCardChoice = null;
  return {};
}

function doChooseLoanTarget(state, action, ctx, log) {
  const pending = state.pendingCardChoice;
  if (!pending) return { error: 'NO_CARD_CHOICE_PENDING' };
  if (pending.seat !== action.seat) return { error: 'NOT_TARGET' };
  if (pending.kind !== 'rateDiscount' && pending.kind !== 'refinance') {
    return { error: 'WRONG_CHOICE_KIND' };
  }
  const seat = state.seats[action.seat];
  const loanId = action.loanId;
  if (!pending.options.includes(loanId)) return { error: 'INVALID_CHOICE' };
  const loan = (seat.loans ?? []).find((l) => l.id === loanId && l.status === 'active');
  if (!loan) return { error: 'NO_LOAN' };
  if (pending.kind === 'rateDiscount') {
    const delta = typeof pending.amount === 'number' ? pending.amount : 0;
    const newPtr = Math.max(0, Math.round((loan.ptr + delta) * 10000) / 10000);
    const paidSoFar = Math.max(0, Math.round((loan.totalDebt - loan.balance) * 100) / 100);
    const newTotalDebt = Math.round(loan.principal * (1 + newPtr * loan.term) * 100) / 100;
    const newBalance = Math.max(0, Math.round((newTotalDebt - paidSoFar) * 100) / 100);
    const remainingPayments = Math.max(1, loan.term - loan.paymentsMade);
    loan.ptr = newPtr;
    loan.totalDebt = newTotalDebt;
    loan.balance = newBalance;
    loan.installment = Math.round((newBalance / remainingPayments) * 100) / 100;
    log('loanRateDiscount', action.seat, { loanId, newPtr });
  } else {
    const roll = Math.floor((ctx?.rng?.() ?? 0.5) * 6) + 1;
    state.rngCursor = (state.rngCursor ?? 0) + 1;
    const reserveRate = state.economy?.reserveRate ?? 0;
    const newPtr = Math.max(0, recomputeLoanPtr(seat, loan, roll, reserveRate));
    loan.ptr = newPtr;
    loan.totalDebt = Math.round(loan.principal * (1 + newPtr * loan.term) * 100) / 100;
    const remainingPayments = Math.max(1, loan.term - loan.paymentsMade);
    loan.installment = Math.round((loan.totalDebt / loan.term) * 100) / 100;
    loan.balance = Math.round(loan.installment * remainingPayments * 100) / 100;
    log('loanRefinanced', action.seat, { loanId, newPtr, roll });
  }
  state.pendingCardChoice = null;
  return {};
}

function recomputeLoanPtr(seat, loan, roll, reserveRate) {
  const tier = effectiveTier(seat);
  const tierPtrs = PTR_BY_TIER_AND_DICE[tier.name];
  if (!tierPtrs) return loan.ptr;
  const base = tierPtrs[Math.max(0, Math.min(5, roll - 1))];
  const term = loan.term ?? 5;
  const premium = TERM_PREMIUM[term] ?? 0;
  return Math.round((base + premium + (reserveRate ?? 0)) * 10000) / 10000;
}

function doSkipCardChoice(state, action, ctx, log) {
  const pending = state.pendingCardChoice;
  if (!pending) return { error: 'NO_CARD_CHOICE_PENDING' };
  if (pending.seat !== action.seat) return { error: 'NOT_TARGET' };
  state.pendingCardChoice = null;
  log('cardChoiceSkipped', action.seat, { kind: pending.kind });
  return {};
}


function doDeclareBankruptcy(state, action, ctx, log) {
  const pa = state.pendingAction;
  if (!pa || pa.type !== 'settleDebt') return { error: 'NO_DEBT' };
  if (pa.debtorSeat !== action.seat) return { error: 'NOT_DEBTOR' };

  const debtor = state.seats[action.seat];
  if (pa.creditor.kind === 'player') {
    // Liquidate to creditor.
    transferToCreditor(state, action.seat, pa.creditor.seat);
    log('bankrupt', action.seat, { creditorSeat: pa.creditor.seat });
  } else {
    returnToBank(state, action.seat);
    log('bankrupt', action.seat, { creditorSeat: null });
  }
  state.pendingAction = null;
  state.pendingTrade = null;

  if (checkGameOver(state)) {
    log('gameOver', null, { winnerSeat: state.winnerSeat });
    return {};
  }

  // If it was the bankrupt player's turn, advance.
  if (state.turn.seat === action.seat) {
    advanceTurn(state);
    log('turnStart', state.turn.seat, null);
  }
  return {};
}

// ---------- END TURN ----------
function doEndTurn(state, action, ctx, log) {
  if (!isCurrentSeat(state, action)) return { error: 'NOT_YOUR_TURN' };
  if (state.turn.phase !== 'endable') return { error: 'BAD_PHASE' };
  if (state.pendingAction) return { error: 'BLOCKED_BY_PENDING' };
  if (state.pendingTrainTravel) return { error: 'BLOCKED_BY_TRAIN_TRAVEL' };
  if (state.pendingJailSeizureChoice) return { error: 'BLOCKED_BY_JAIL_SEIZURE' };
  if (state.pendingCardChoice) return { error: 'BLOCKED_BY_CARD_CHOICE' };
  continueEndTurnFlow(state, ctx, log);
  return {};
}

// Shared by doEndTurn and finalizeAuction: drains state.pendingAuctions one at
// a time. While auctions remain, sets pendingAction to the next live auction
// instead of advancing the turn. When the queue empties, applies the standard
// end-turn rules (roll-again on doubles, otherwise advance).
function continueEndTurnFlow(state, ctx, log) {
  if (state.pendingAuctions && state.pendingAuctions.length > 0) {
    const next = state.pendingAuctions.shift();
    const auction = createAuction(next.spaceIndex);
    state.pendingAction = auction;
    state.turn.phase = 'resolving';
    log('auctionStart', null, {
      spaceIndex: next.spaceIndex,
      endsAtMs: auction.endsAtMs,
      reason: next.reason ?? null
    });
    return;
  }
  const seat = state.seats[state.turn.seat];
  const wasDoubles = state.turn.lastRollWasDoubles;
  if (seat && wasDoubles && !seat.inJail && state.turn.doublesCount < MAX_DOUBLES) {
    state.turn.phase = 'preRoll';
    state.turn.lastRoll = null;
    state.turn.lastRollWasDoubles = false;
    log('rollAgain', state.turn.seat, null);
    return;
  }
  advanceTurn(state);
  state.turnCount = (state.turnCount ?? 0) + 1;

  if (state.economy) {
    const expired = expireEconomyTempEffects(state.economy, state.turnCount, ctx?.rng);
    if (expired.length > 0) {
      log('economyTempEffectsExpired', null, { kinds: expired.map((e) => e.kind) });
    }
  }

  if (state.economy && ctx?.rng) {
    const result = flipEconomy(state.economy, ctx.rng);
    state.rngCursor++;
    log('economyFlip', null, {
      card: result.card,
      intIgnored: result.intIgnored,
      reshuffled: result.reshuffled,
      reserveRate: result.reserveRate,
      inflationFactor: result.inflationFactor
    });
  }
  if (state.stocks && ctx?.rng) {
    const results = flipMarket(state.stocks, ctx.rng);
    state.rngCursor++;
    clearStaleWildcardReveals(state, results.__reshuffled);
    log('marketFlip', null, { results, source: 'auto' });
  }
  if (state.turnCount > 0) {
    const interestEvents = accrueCardInterest(
      state.seats,
      state.turnCount,
      state.economy?.reserveRate ?? 0
    );
    for (const e of interestEvents) {
      log('cardInterest', e.seatIndex, e);
    }
  }
  const newSeat = state.seats[state.turn.seat];
  if (newSeat) {
    // Decay temp-effects from prior turns. Effects with expiresInTurns <= 1
    // are removed; the rest are decremented.
    const expired = decayTempEffects(newSeat);
    if (expired.length > 0) {
      log('tempEffectsExpired', state.turn.seat, {
        effects: expired.map((e) => e.effectId)
      });
    }
    // Reset the once-per-turn event-card flag.
    newSeat.drewEventCardThisTurn = false;
    const hysaEvents = applyHysaInterestAtTurnStart(
      newSeat,
      state.economy?.reserveRate ?? 0
    );
    for (const e of hysaEvents) {
      log('hysaInterest', state.turn.seat, e);
    }
    // Charge each active credit card's rotating fee. Cards auto-cancel if the
    // seat can't afford the fee; we surface those as separate log entries.
    if (Array.isArray(newSeat.creditCards) && newSeat.creditCards.length > 0) {
      const events = applyTurnStartCardFees(newSeat);
      for (const e of events) {
        log(e.action === 'autoCancelled' ? 'cardCancelled' : 'cardFee', state.turn.seat, e);
      }
    }
    // Mark active loans due. The seat will be blocked from rolling until they
    // respond to each due loan.
    if (Array.isArray(newSeat.loans) && newSeat.loans.length > 0) {
      if (markLoansDueAtTurnStart(newSeat)) {
        log('loansDue', state.turn.seat, {
          count: newSeat.loans.filter((l) => l.dueThisTurn).length
        });
      }
    }
    if (Array.isArray(newSeat.mortgageLoans) && newSeat.mortgageLoans.length > 0) {
      if (markMortgageLoansDueAtTurnStart(newSeat)) {
        log('mortgageLoansDue', state.turn.seat, {
          count: newSeat.mortgageLoans.filter((l) => l.dueThisTurn).length
        });
      }
    }
  }
  log('turnStart', state.turn.seat, null);
}

// ---------- STOCK MARKET ----------
function doBuyStock(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat || seat.bankrupt) return { error: 'BANKRUPT' };
  const r = buyShares(seat, state.stocks, action.symbol, action.qty);
  if (!r.ok) return { error: r.error };
  log('buyStock', action.seat, { symbol: action.symbol, qty: r.qty, cost: r.cost, price: r.price });
  return {};
}

// Buy stock funded by a credit card. Bypasses buyShares' cash gate — the
// charge goes directly on the card balance, then we credit shares and bump
// cost basis manually. Cost basis tracks the dollar value of the purchase
// regardless of funding source so realised P&L stays consistent.
function doBuyStockWithCard(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat || seat.bankrupt) return { error: 'BANKRUPT' };
  const symbol = action.symbol;
  const qty = action.qty;
  const market = state.stocks?.market?.[symbol];
  if (!market) return { error: 'UNKNOWN_STOCK' };
  if (!Number.isInteger(qty) || qty <= 0) return { error: 'BAD_QTY' };
  const price = market.price ?? 0;
  const cost = Math.round(price * qty * 100) / 100;
  const charge = chargeCard(seat, action.instanceId, cost);
  if (!charge.ok) return { error: charge.error };
  seat.stockLots[symbol] = (seat.stockLots[symbol] || 0) + qty;
  seat.stockCostBasis[symbol] = Math.round(((seat.stockCostBasis[symbol] || 0) + cost) * 100) / 100;
  log('buyStockWithCard', action.seat, {
    symbol, qty, cost, price,
    instanceId: action.instanceId,
    cardBalance: charge.balance,
    creditLine: charge.limit
  });
  return {};
}

function doPayCardBalance(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  const r = payCardBalance(seat, action.instanceId, action.amount);
  if (!r.ok) return { error: r.error };
  log('cardPayment', action.seat, {
    instanceId: action.instanceId,
    paid: r.paid,
    balance: r.balance
  });
  return {};
}

function doSellStock(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat || seat.bankrupt) return { error: 'BANKRUPT' };
  const r = sellShares(seat, state.stocks, action.symbol, action.qty);
  if (!r.ok) return { error: r.error };
  log('sellStock', action.seat, { symbol: action.symbol, qty: r.qty, proceeds: r.proceeds, price: r.price });
  return {};
}

// ---------- LOANS ----------
function doRequestLoan(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat || seat.bankrupt) return { error: 'BANKRUPT' };
  const bank = action.bank ?? 'mmcu';
  if (!BANKS[bank]) return { error: 'UNKNOWN_BANK' };
  if (bank === 'boardwalk') {
    const tier = getTierByScore(seat.creditScore ?? 0).name;
    if (tier !== 'Very Good' && tier !== 'Excellent') {
      return { error: 'BOARDWALK_TIER_GATE' };
    }
  }
  const reserveRate = state.economy?.reserveRate ?? 0;
  const boardwalkDiscount =
    bank === 'boardwalk' && eligibleForBoardwalkDiscount(seat)
      ? BANKS.boardwalk.loanDiscountIfMmFree
      : 0;
  const roll = rollLoanDie(ctx.rng);
  state.rngCursor++;
  const r = requestLoanOffer(seat, action.amount, roll, {
    bank,
    reserveRate,
    boardwalkDiscount
  });
  if (!r.ok) return { error: r.error };
  log('loanOffer', action.seat, {
    bank,
    principal: r.offer.principal,
    roll,
    tier: r.offer.tier,
    reserveRate,
    boardwalkDiscount,
    options: r.offer.options
  });
  return {};
}

function doRespondLoanOffer(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  if (action.decline) {
    const r = declineLoanOffer(seat);
    if (!r.ok) return { error: r.error };
    log('loanDeclined', action.seat, null);
    return {};
  }
  const r = acceptLoanOffer(seat, action.term, Date.now());
  if (!r.ok) return { error: r.error };
  log('loanAccepted', action.seat, {
    loanId: r.loan.id,
    principal: r.loan.principal,
    term: r.loan.term,
    ptr: r.loan.ptr,
    totalDebt: r.loan.totalDebt
  });
  return {};
}

function doPayLoanInstallment(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  const r = payLoanInstallment(seat, action.loanId);
  if (!r.ok) return { error: r.error };
  log('loanPayment', action.seat, {
    loanId: action.loanId,
    paid: r.paid,
    bankCovered: r.bankCovered ?? 0,
    due: r.due,
    balance: r.loan.balance,
    closed: r.loan.status === 'closed'
  });
  return {};
}

function doSkipLoanInstallment(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  const r = skipLoanInstallment(seat, action.loanId);
  if (!r.ok) return { error: r.error };
  log('loanSkipped', action.seat, {
    loanId: action.loanId,
    creditScore: seat.creditScore
  });
  return {};
}

function doPayoffLoan(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  const r = payoffLoan(seat, action.loanId);
  if (!r.ok) return { error: r.error };
  log('loanPaidOff', action.seat, { loanId: action.loanId, paid: r.paid });
  return {};
}

function doRequestCreditLineIncrease(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat || seat.bankrupt) return { error: 'BANKRUPT' };
  const r = requestCreditLineIncrease(seat, action.instanceId);
  if (!r.ok) return { error: r.error };
  log('creditLineIncreaseRequested', action.seat, {
    instanceId: action.instanceId,
    oldLine: r.oldLine,
    newLine: r.newLine,
    increased: r.increased
  });
  return {};
}

function doRequestCreditCard(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat || seat.bankrupt) return { error: 'BANKRUPT' };
  const r = applyForCard(seat, action.cardId, state.turnCount ?? 0, Date.now());
  if (!r.ok) return { error: r.error };
  log('cardAcquired', action.seat, {
    cardId: action.cardId,
    instanceId: r.card.id,
    signingFee: r.signingFee,
    signupBonus: r.signupBonus
  });
  return {};
}

function doCancelCreditCard(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  const r = cancelCard(seat, action.instanceId);
  if (!r.ok) return { error: r.error };
  log('cardCancelled', action.seat, {
    instanceId: action.instanceId,
    cancelFee: r.cancelFee
  });
  return {};
}

// ---------- EVENT CARDS ----------
// Auto-draw a reserve event card for the seat. Called from applySpaceEffect
// when a player lands on a chance / community-chest space. Idempotent within a
// turn — the once-per-turn flag (also used by the legacy code path) prevents a
// second auto-draw when doubles re-land on a card space. Silently no-ops on
// bankruptcy or empty decks; failures are logged but never block the landing.
function autoDrawReserveCard(state, seatIndex, deckName, ctx, log) {
  const seat = state.seats[seatIndex];
  if (!seat || seat.bankrupt) return;
  if (seat.drewEventCardThisTurn) return;
  if (deckName !== 'community' && deckName !== 'chance') return;
  const cardId = drawReserveCard(state, deckName, ctx.rng);
  state.rngCursor++;
  if (!cardId) return;
  const r = applyEventCard(state, seatIndex, deckName, cardId, ctx, log);
  discardReserveCard(state, deckName, cardId);
  if (!r.ok) return;
  seat.lastDrawnEventCard = {
    cardId,
    deck: deckName,
    drawnAt: Date.now(),
    results: r.results
  };
  seat.drewEventCardThisTurn = true;
  log('eventCardDrawn', seatIndex, {
    cardId,
    deck: deckName,
    effects: r.results.effects
  });
}

function doDismissEventCard(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  if (!seat.lastDrawnEventCard) return { error: 'NO_CARD' };
  seat.lastDrawnEventCard = null;
  return {};
}

// Server-injected tick driving the Market Open window. Each tick applies the
// next pre-rolled flip frame to the live stocks, decrements the remaining
// counter, and either schedules the next tick or closes the window.
function doMarketOpenTick(state, action, ctx, log) {
  if (!action._server) return { error: 'NOT_AUTHORIZED' };
  if (!state.marketOpen?.active) return { error: 'NO_MARKET_OPEN' };
  const tickIndex = state.marketOpen.ticksFired;
  const r = applyMarketOpenTick(state);
  if (r.error) return { error: r.error };
  log('marketOpenTick', null, {
    tickIndex,
    results: r.results ?? null,
    done: !!r.done
  });
  if (r.done) {
    log('marketOpenEnd', null, null);
  } else {
    log('marketTickScheduled', null, { nextTickAtMs: r.nextTickAtMs });
  }
  return {};
}

// ---------- TRANSFERS ----------
function doWireAction(state, action, ctx, log) {
  const r = doWireTransfer(state, action.seat, action.toSeat, action.amount);
  if (!r.ok) return { error: r.error };
  log('wireTransfer', action.seat, {
    fromSeat: action.seat,
    toSeat: action.toSeat,
    amount: r.amount
  });
  return {};
}

function doRequestTransferAction(state, action, ctx, log) {
  const r = createTransferRequest(state, action.seat, action.toSeat, action.amount, action.note);
  if (!r.ok) return { error: r.error };
  log('transferRequested', action.seat, {
    requestId: r.request.id,
    fromSeat: r.request.fromSeat,
    toSeat: r.request.toSeat,
    amount: r.request.amount,
    note: r.request.note
  });
  return {};
}

function doRespondTransferAction(state, action, ctx, log) {
  const r = respondTransferRequest(state, action.requestId, action.seat, !!action.approve);
  if (!r.ok) return { error: r.error };
  log(r.approved ? 'transferApproved' : 'transferDenied', action.seat, {
    requestId: r.request.id,
    fromSeat: r.request.fromSeat,
    toSeat: r.request.toSeat,
    amount: r.request.amount
  });
  return {};
}

function doCancelTransferAction(state, action, ctx, log) {
  const r = cancelTransferRequest(state, action.requestId, action.seat);
  if (!r.ok) return { error: r.error };
  log('transferCancelled', action.seat, {
    requestId: r.request.id,
    amount: r.request.amount
  });
  return {};
}

// ---------- HOST: SKIP DISCONNECTED PLAYER ----------
function doSkipPlayer(state, action, ctx, log) {
  // action.seat is the host; action.targetSeat is the seat being skipped.
  if (action.seat == null) return { error: 'NO_SEAT' };
  if (state.seats[action.seat]?.playerToken !== state.hostPlayerToken) return { error: 'NOT_HOST' };
  if (state.turn.seat !== action.targetSeat) return { error: 'NOT_TARGET_TURN' };
  const target = state.seats[action.targetSeat];
  if (target.connected) return { error: 'TARGET_CONNECTED' };
  if (!target.disconnectedAt || Date.now() - target.disconnectedAt < 60_000) {
    return { error: 'WAIT_LONGER' };
  }
  state.pendingAction = null;
  advanceTurn(state);
  log('skipPlayer', action.targetSeat, null);
  log('turnStart', state.turn.seat, null);
  return {};
}

function doOpenBankAccount(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  if (seat.bankrupt) return { error: 'BANKRUPT' };
  const r = openAccount(seat, action.bank, Date.now());
  if (!r.ok) return { error: r.error };
  log('bankAccountOpened', action.seat, { bank: action.bank });
  return {};
}

function doCloseBankAccount(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  const r = closeAccount(seat, action.bank);
  if (!r.ok) return { error: r.error };
  log('bankAccountClosed', action.seat, { bank: action.bank });
  return {};
}

function doDepositToBank(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  if (seat.bankrupt) return { error: 'BANKRUPT' };
  const r = deposit(seat, action.bank, action.amount);
  if (!r.ok) return { error: r.error };
  log('deposit', action.seat, {
    bank: action.bank,
    amount: r.amount,
    cash: r.cash,
    balance: r.balance
  });
  return {};
}

function doWithdrawFromBank(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  if (seat.bankrupt) return { error: 'BANKRUPT' };
  const r = withdraw(seat, action.bank, action.amount);
  if (!r.ok) return { error: r.error };
  log('withdraw', action.seat, {
    bank: action.bank,
    amount: r.amount,
    cash: r.cash,
    balance: r.balance
  });
  return {};
}

// ---------- HELPERS ----------
function finalizeTurnPhase(state, doubles) {
  if (state.pendingAction) {
    state.turn.phase = 'resolving';
    return;
  }
  state.turn.phase = 'endable';
  // doubles handled in doEndTurn (player must press End Turn / Roll Again themselves).
}

function recomputePhase(state) {
  if (state.pendingAction) {
    state.turn.phase = 'resolving';
  } else if (state.turn.phase === 'resolving') {
    state.turn.phase = 'endable';
  }
}
