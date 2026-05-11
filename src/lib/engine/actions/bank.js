// Bank-account actions: open / close / deposit / withdraw. Each is a thin
// wrapper that delegates to engine/reserve/banking.js and emits the matching
// log event.

import {
  openAccount,
  closeAccount,
  deposit,
  withdraw
} from '../reserve/banking.js';

export function doOpenBankAccount(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  if (seat.bankrupt) return { error: 'BANKRUPT' };
  const r = openAccount(seat, action.bank, Date.now());
  if (!r.ok) return { error: r.error };
  log('bankAccountOpened', action.seat, { bank: action.bank });
  return {};
}

export function doCloseBankAccount(state, action, ctx, log) {
  const seat = state.seats[action.seat];
  if (!seat) return { error: 'NO_SEAT' };
  const r = closeAccount(seat, action.bank);
  if (!r.ok) return { error: r.error };
  log('bankAccountClosed', action.seat, { bank: action.bank });
  return {};
}

export function doDepositToBank(state, action, ctx, log) {
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

export function doWithdrawFromBank(state, action, ctx, log) {
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
