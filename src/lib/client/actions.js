// Typed action senders. Each helper validates the action type against the
// allowlist (typos throw at the call site instead of silently failing on the
// server with `UNKNOWN_ACTION`) and forwards the payload through `send`.
//
// To add a new action: add the type to ACTION_TYPES and call it via
// `actions.<type>(payload?)` from any component. Components should NOT call
// `send({ type: '…' })` directly — use this module so the allowlist stays
// authoritative.

import { send } from './socket.js';

// Authoritative list of every action a client can dispatch. Mirrors the
// reducer's dispatch switch in src/lib/engine/reducer.js plus the lobby
// actions that the server's `dispatch.js` routes by message type.
export const ACTION_TYPES = [
  // --- Lobby ---
  'auth',
  'createRoom',
  'joinRoom',
  'leaveRoom',
  'startGame',
  // --- Roll-off ---
  'rollForOrder',
  // --- Turn / dice ---
  'rollDice',
  'endTurn',
  'skipPlayer',
  // --- Property buy / decline / auction ---
  'buyProperty',
  'buyPropertyWithMortgage',
  'buyPropertyWithCard',
  'declineToBuy',
  'bid',
  // --- Houses ---
  'buyHouse',
  'sellHouse',
  // --- Trade ---
  'proposeTrade',
  'respondTrade',
  'cancelTrade',
  // --- Jail ---
  'useGetOutOfJail',
  'payJailFine',
  'rollForJail',
  'chooseJailSeizure',
  // --- Train + card choices ---
  'chooseTrainDestination',
  'skipTrainTravel',
  'chooseStockTarget',
  'chooseLoanTarget',
  'skipCardChoice',
  // --- Stocks ---
  'buyStock',
  'buyStockWithCard',
  'sellStock',
  // --- Loans ---
  'requestLoan',
  'respondLoanOffer',
  'payLoanInstallment',
  'skipLoanInstallment',
  'payoffLoan',
  // --- Credit cards ---
  'requestCreditCard',
  'requestCreditLineIncrease',
  'cancelCreditCard',
  'payCardBalance',
  // --- Bank accounts ---
  'openBankAccount',
  'closeBankAccount',
  'depositToBank',
  'withdrawFromBank',
  // --- Mortgage loans ---
  'requestMortgageLoan',
  'payMortgageInstallment',
  'skipMortgageInstallment',
  'payoffMortgageLoan',
  'sellPropertyToBank',
  // --- Transfers ---
  'wireTransfer',
  'requestTransfer',
  'respondTransfer',
  'cancelTransfer',
  // --- Misc ---
  'declareBankruptcy'
];

const ACTION_SET = new Set(ACTION_TYPES);

// Generic action dispatcher. Throws (in dev) on an unknown type so typos
// surface at the call site instead of returning UNKNOWN_ACTION from the server.
function sendAction(type, payload) {
  if (!ACTION_SET.has(type)) {
    const err = `actions: unknown action type '${type}'`;
    if (typeof window !== 'undefined' && window.__monopoly?.debug) {
      throw new Error(err);
    } else {
      console.warn(err);
    }
  }
  send(payload ? { type, ...payload } : { type });
}

// Build `actions.<type>(payload?)` accessors over the allowlist so each
// caller can use a typo-checkable identifier rather than a string literal.
export const actions = Object.fromEntries(
  ACTION_TYPES.map((t) => [t, (payload) => sendAction(t, payload)])
);
