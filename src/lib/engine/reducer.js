// The reducer is a slim dispatcher. Every game action lives in a per-domain
// module under engine/actions/; this file only:
//   1. Validates the room is in a state where actions are accepted (rollOff
//      vs playing, market-open lockout, jail-blocked actions).
//   2. Routes the action to its handler via ACTION_REGISTRY.
//   3. After every successful action, runs cross-cutting end-of-action checks
//      (credit-collapse bankruptcy auto-trigger, advance-past-bankrupt-seat).
//   4. Wraps the whole thing in a structuredClone so handlers can mutate freely.

import { advanceTurn } from './turn.js';
import { checkAndExecuteCreditBankruptcy } from './bankruptcy.js';
import { MARKET_OPEN_ALLOWED_ACTIONS } from './reserve/marketOpen.js';
import { doRollForOrder } from './rollOff.js';
import {
  doOpenBankAccount,
  doCloseBankAccount,
  doDepositToBank,
  doWithdrawFromBank
} from './actions/bank.js';
import {
  doWireAction,
  doRequestTransferAction,
  doRespondTransferAction,
  doCancelTransferAction
} from './actions/transfers.js';
import {
  doProposeTrade,
  doRespondTrade,
  doCancelTrade
} from './actions/trade.js';
import {
  doUseGetOutOfJail,
  doPayJailFine,
  doRollForJail,
  doChooseJailSeizure
} from './actions/jail.js';
import {
  doRequestLoan,
  doRespondLoanOffer,
  doPayLoanInstallment,
  doSkipLoanInstallment,
  doPayoffLoan
} from './actions/loans.js';
import {
  doRequestCreditCard,
  doRequestCreditLineIncrease,
  doCancelCreditCard,
  doPayCardBalance
} from './actions/cards.js';
import {
  doBuyStock,
  doBuyStockWithCard,
  doSellStock,
  doMarketOpenTick
} from './actions/stocks.js';
import {
  doBuyProperty,
  doDeclineToBuy,
  doBuyPropertyWithMortgage,
  doBuyPropertyWithCard,
  doBuyHouse,
  doSellHouse
} from './actions/property.js';
import {
  doRequestMortgageLoan,
  doPayMortgageInstallment,
  doSkipMortgageInstallment,
  doPayoffMortgageLoan,
  doSellPropertyToBank
} from './actions/mortgage.js';
import { doBid, doAuctionTick } from './actions/auction.js';
import {
  doRollDice,
  doEndTurn,
  doDeclareBankruptcy,
  doSkipPlayer,
  doChooseTrainDestination,
  doSkipTrainTravel,
  doChooseStockTarget,
  doChooseLoanTarget,
  doSkipCardChoice
} from './actions/turn.js';

// action.type → handler. Adding a new action means adding one entry here and
// (for client-facing actions) one entry to lib/client/actions.js#ACTION_TYPES.
const ACTION_REGISTRY = new Map([
  ['rollDice', doRollDice],
  ['buyProperty', doBuyProperty],
  ['buyPropertyWithMortgage', doBuyPropertyWithMortgage],
  ['buyPropertyWithCard', doBuyPropertyWithCard],
  ['declineToBuy', doDeclineToBuy],
  ['bid', doBid],
  ['auctionTick', doAuctionTick],
  ['marketOpenTick', doMarketOpenTick],
  ['buyStock', doBuyStock],
  ['buyStockWithCard', doBuyStockWithCard],
  ['payCardBalance', doPayCardBalance],
  ['sellStock', doSellStock],
  ['requestLoan', doRequestLoan],
  ['respondLoanOffer', doRespondLoanOffer],
  ['payLoanInstallment', doPayLoanInstallment],
  ['skipLoanInstallment', doSkipLoanInstallment],
  ['payoffLoan', doPayoffLoan],
  ['requestCreditCard', doRequestCreditCard],
  ['requestCreditLineIncrease', doRequestCreditLineIncrease],
  ['cancelCreditCard', doCancelCreditCard],
  ['wireTransfer', doWireAction],
  ['requestTransfer', doRequestTransferAction],
  ['respondTransfer', doRespondTransferAction],
  ['cancelTransfer', doCancelTransferAction],
  ['openBankAccount', doOpenBankAccount],
  ['closeBankAccount', doCloseBankAccount],
  ['depositToBank', doDepositToBank],
  ['withdrawFromBank', doWithdrawFromBank],
  ['requestMortgageLoan', doRequestMortgageLoan],
  ['payMortgageInstallment', doPayMortgageInstallment],
  ['skipMortgageInstallment', doSkipMortgageInstallment],
  ['payoffMortgageLoan', doPayoffMortgageLoan],
  ['sellPropertyToBank', doSellPropertyToBank],
  ['buyHouse', doBuyHouse],
  ['sellHouse', doSellHouse],
  ['proposeTrade', doProposeTrade],
  ['respondTrade', doRespondTrade],
  ['cancelTrade', doCancelTrade],
  ['useGetOutOfJail', doUseGetOutOfJail],
  ['payJailFine', doPayJailFine],
  ['rollForJail', doRollForJail],
  ['chooseJailSeizure', doChooseJailSeizure],
  ['chooseTrainDestination', doChooseTrainDestination],
  ['skipTrainTravel', doSkipTrainTravel],
  ['chooseStockTarget', doChooseStockTarget],
  ['chooseLoanTarget', doChooseLoanTarget],
  ['skipCardChoice', doSkipCardChoice],
  ['declareBankruptcy', doDeclareBankruptcy],
  ['endTurn', doEndTurn],
  ['skipPlayer', doSkipPlayer]
]);

const JAIL_BLOCKED_ACTIONS = new Set([
  'buyStock', 'buyStockWithCard', 'sellStock',
  'requestLoan', 'respondLoanOffer', 'payLoanInstallment', 'skipLoanInstallment', 'payoffLoan',
  'requestCreditCard', 'requestCreditLineIncrease', 'cancelCreditCard', 'payCardBalance',
  'requestMortgageLoan', 'payMortgageInstallment', 'skipMortgageInstallment', 'payoffMortgageLoan',
  'sellPropertyToBank',
  'openBankAccount', 'closeBankAccount', 'depositToBank', 'withdrawFromBank',
  'wireTransfer', 'requestTransfer', 'respondTransfer', 'cancelTransfer',
  'buyHouse', 'sellHouse',
  'buyProperty', 'buyPropertyWithMortgage', 'buyPropertyWithCard',
  'proposeTrade', 'respondTrade', 'cancelTrade'
]);

// Sells need to remain available to a jailed seat with an open settleDebt —
// otherwise the player has assets in hand but no way to liquidate, and the only
// option is bankruptcy. These specific sells unblock that softlock.
const JAIL_DEBT_LIQUIDATION_ALLOWED = new Set([
  'sellHouse',
  'sellPropertyToBank'
]);

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
    return runAction(state, action, ctx, doRollForOrder);
  }
  if (state.phase !== 'playing') {
    return { ok: false, error: 'NOT_PLAYING' };
  }
  return runAction(state, action, ctx, dispatch);
}

// Run a handler against a deep-cloned state, gather log events, and apply the
// post-action cross-cutting checks (credit collapse, skip-bankrupt-seat).
function runAction(state, action, ctx, handler) {
  const next = structuredClone(state);
  const events = [];
  const log = (type, seat, payload) =>
    events.push({ ts: Date.now(), seat: seat ?? null, type, payload: payload ?? null });

  const result = handler(next, action, ctx, log);
  if (result.error) return { ok: false, error: result.error };

  if (next.phase === 'playing' && Array.isArray(next.seats)) {
    for (let i = 0; i < next.seats.length; i++) {
      checkAndExecuteCreditBankruptcy(next, i, ctx, log);
    }
    if (next.turn && next.seats[next.turn.seat]?.bankrupt) {
      advanceTurn(next);
      log('turnAdvancedAfterBankruptcy', next.turn.seat, null);
    }
  }

  next.log.push(...events);
  next.updatedAt = Date.now();
  return { ok: true, state: next, events };
}

// Routes a "playing"-phase action through the gate checks (market-open,
// jail-blocked) before invoking the registered handler.
function dispatch(state, action, ctx, log) {
  if (state.marketOpen?.active && !MARKET_OPEN_ALLOWED_ACTIONS.has(action.type)) {
    return { error: 'MARKET_OPEN_ACTIVE' };
  }
  if (
    typeof action.seat === 'number' &&
    state.seats?.[action.seat]?.inJail &&
    JAIL_BLOCKED_ACTIONS.has(action.type)
  ) {
    const allowedForDebt =
      state.pendingAction?.type === 'settleDebt' &&
      state.pendingAction.debtorSeat === action.seat &&
      JAIL_DEBT_LIQUIDATION_ALLOWED.has(action.type);
    if (!allowedForDebt) return { error: 'JAILED' };
  }
  const handler = ACTION_REGISTRY.get(action.type);
  if (!handler) return { error: 'UNKNOWN_ACTION' };
  return handler(state, action, ctx, log);
}
