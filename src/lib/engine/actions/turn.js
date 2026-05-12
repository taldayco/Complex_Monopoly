// Turn-flow handlers: the dice roll itself, end-of-turn / new-turn machinery,
// the pending-card-choice picker handlers (stock target, loan target, skip),
// the train-travel pickers, declare-bankruptcy, and host's skipPlayer.
//
// continueEndTurnFlow is exported because actions/auction.js needs to drain
// the pending-auctions queue back into it after settling.

import { MAX_DOUBLES } from '../../shared/constants.js';
import { advancePosition, rollDice as rollDiceFn } from '../movement.js';
import { inflatedSalary } from '../../shared/economy/inflation.js';
import { sendToJailWithSeizure } from '../jail.js';
import { advanceTurn } from '../turn.js';
import { transferToCreditor, returnToBank, checkGameOver } from '../bankruptcy.js';
import { flipMarket } from '../reserve/stocks.js';
import { flipEconomy, expireEconomyTempEffects } from '../reserve/economy.js';
import { applyHysaInterestAtTurnStart } from '../reserve/banking.js';
import { applyTurnStartCardFees, accrueCardInterest } from '../reserve/cards.js';
import { markLoansDueAtTurnStart } from '../reserve/loans.js';
import { markMortgageLoansDueAtTurnStart } from '../mortgage.js';
import { decayTempEffects } from '../reserve/eventCards.js';
import { createAuction } from '../auction.js';
import {
  effectiveTier,
  PTR_BY_TIER_AND_DICE,
  TERM_PREMIUM
} from '../../shared/reserve/loanCatalog.js';
import {
  isCurrentSeat,
  finalizeTurnPhase,
  tryAutoSettle,
  clearStaleWildcardReveals
} from '../_helpers.js';
import {
  resolveLanding,
  applyGoCardBonuses
} from '../landing.js';
import { cents, round4 } from '../../shared/money.js';

// ---------- ROLL DICE ----------
export function doRollDice(state, action, ctx, log) {
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
  }

  log('rollDice', action.seat, { d1: roll.d1, d2: roll.d2, doubles: roll.doubles });

  const { passedGo } = advancePosition(state, seat, roll.total);
  if (passedGo) log('passGo', action.seat, { amount: inflatedSalary(state) });
  applyGoCardBonuses(state, action.seat, passedGo, log);

  resolveLanding(state, action.seat, ctx, log, { diceTotal: roll.total });
  finalizeTurnPhase(state);
  return {};
}

// ---------- TRAIN TRAVEL ----------
export function doChooseTrainDestination(state, action, ctx, log) {
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
    const salary = inflatedSalary(state);
    seat.cash = cents(seat.cash + salary);
    log('passGo', action.seat, { amount: salary });
  }
  state.pendingTrainTravel = null;
  log('trainTraveled', action.seat, { fromIdx: from, toIdx: to, passedGo });
  return {};
}

export function doSkipTrainTravel(state, action, ctx, log) {
  const pending = state.pendingTrainTravel;
  if (!pending) return { error: 'NO_TRAIN_PENDING' };
  if (pending.seat !== action.seat) return { error: 'NOT_TRAVELER' };
  state.pendingTrainTravel = null;
  log('trainTravelSkipped', action.seat, null);
  return {};
}

// ---------- CARD-CHOICE PICKERS ----------
export function doChooseStockTarget(state, action, ctx, log) {
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
    market.price = Math.max(0.01, cents(market.price * factor));
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

export function doChooseLoanTarget(state, action, ctx, log) {
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
    const newPtr = Math.max(0, round4(loan.ptr + delta));
    const paidSoFar = Math.max(0, cents(loan.totalDebt - loan.balance));
    const newTotalDebt = cents(loan.principal * (1 + newPtr * loan.term));
    const newBalance = Math.max(0, cents(newTotalDebt - paidSoFar));
    const remainingPayments = Math.max(1, loan.term - loan.paymentsMade);
    loan.ptr = newPtr;
    loan.totalDebt = newTotalDebt;
    loan.balance = newBalance;
    loan.installment = cents(newBalance / remainingPayments);
    log('loanRateDiscount', action.seat, { loanId, newPtr });
  } else {
    if (typeof ctx?.rng !== 'function') return { error: 'NO_RNG' };
    const roll = Math.floor(ctx.rng() * 6) + 1;
    state.rngCursor = (state.rngCursor ?? 0) + 1;
    const reserveRate = state.economy?.reserveRate ?? 0;
    const newPtr = Math.max(0, recomputeLoanPtr(seat, loan, roll, reserveRate));
    const paidSoFar = Math.max(0, cents(loan.totalDebt - loan.balance));
    const newTotalDebt = cents(loan.principal * (1 + newPtr * loan.term));
    const newBalance = Math.max(0, cents(newTotalDebt - paidSoFar));
    const remainingPayments = Math.max(1, loan.term - loan.paymentsMade);
    loan.ptr = newPtr;
    loan.totalDebt = newTotalDebt;
    loan.balance = newBalance;
    loan.installment = cents(newBalance / remainingPayments);
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
  return round4(base + premium + (reserveRate ?? 0));
}

export function doSkipCardChoice(state, action, ctx, log) {
  const pending = state.pendingCardChoice;
  if (!pending) return { error: 'NO_CARD_CHOICE_PENDING' };
  if (pending.seat !== action.seat) return { error: 'NOT_TARGET' };
  state.pendingCardChoice = null;
  log('cardChoiceSkipped', action.seat, { kind: pending.kind });
  return {};
}

// ---------- BANKRUPTCY ----------
export function doDeclareBankruptcy(state, action, ctx, log) {
  const pa = state.pendingAction;
  if (!pa || pa.type !== 'settleDebt') return { error: 'NO_DEBT' };
  if (pa.debtorSeat !== action.seat) return { error: 'NOT_DEBTOR' };

  if (pa.creditor.kind === 'player') {
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
export function doEndTurn(state, action, ctx, log) {
  if (!isCurrentSeat(state, action)) return { error: 'NOT_YOUR_TURN' };
  if (state.turn.phase !== 'endable') return { error: 'BAD_PHASE' };
  if (state.pendingAction) return { error: 'BLOCKED_BY_PENDING' };
  if (state.pendingTrainTravel) return { error: 'BLOCKED_BY_TRAIN_TRAVEL' };
  if (state.pendingJailSeizureChoice) return { error: 'BLOCKED_BY_JAIL_SEIZURE' };
  if (state.pendingCardChoice) return { error: 'BLOCKED_BY_CARD_CHOICE' };
  continueEndTurnFlow(state, ctx, log);
  return {};
}

// Shared by doEndTurn and finalizeAuction (engine/actions/auction.js): drains
// state.pendingAuctions one at a time. While auctions remain, sets pendingAction
// to the next live auction instead of advancing the turn. When the queue empties,
// applies the standard end-turn rules (roll-again on doubles, otherwise advance).
export function continueEndTurnFlow(state, ctx, log) {
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
    const expired = expireEconomyTempEffects(state.economy, state.turnCount);
    if (expired.length > 0) {
      log('economyTempEffectsExpired', null, { kinds: expired.map((e) => e.kind) });
    }
  }

  if (state.economy && ctx?.rng) {
    const prevFactor = state.economy.inflationFactor;
    const result = flipEconomy(state.economy, ctx.rng);
    state.rngCursor++;
    log('economyFlip', null, {
      card: result.card,
      policyDelta: result.policyDelta,
      intIgnored: result.intIgnored,
      reshuffled: result.reshuffled,
      reserveRate: result.reserveRate,
      inflationFactor: result.inflationFactor
    });
    const delta = prevFactor > 0 ? (result.inflationFactor / prevFactor) - 1 : 0;
    if (delta > 0) {
      const breakdown = [];
      let totalEroded = 0;
      for (const seat of state.seats) {
        if (seat.bankrupt) continue;
        const eroded = cents(seat.cash * delta / (1 + delta));
        if (eroded <= 0) continue;
        seat.cash = cents(seat.cash - eroded);
        totalEroded = cents(totalEroded + eroded);
        breakdown.push({ seat: seat.seat, eroded });
      }
      if (totalEroded > 0) log('inflationErosion', null, { delta, totalEroded, breakdown });
    }
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

// ---------- HOST: SKIP DISCONNECTED PLAYER ----------
export function doSkipPlayer(state, action, ctx, log) {
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
