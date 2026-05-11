// Cross-cutting helpers shared between reducer.js and the per-domain action
// modules under engine/actions/. Anything here is a pure-ish helper that
// mutates the cloned room state passed in.
//
// Lives at the engine root (not inside actions/) so action modules can import
// it without depending on the dispatcher itself — keeps imports acyclic.

import { cents } from '../shared/money.js';

export function isCurrentSeat(state, action) {
  return action.seat === state.turn.seat;
}

// ---------- TURN PHASE ----------
// `resolving` means a pendingAction is open. `endable` means the player can
// click End Turn. `finalizeTurnPhase` runs at the end of the dice path and
// `recomputePhase` runs after any pendingAction-clearing action.
export function finalizeTurnPhase(state) {
  if (state.pendingAction) {
    state.turn.phase = 'resolving';
    return;
  }
  state.turn.phase = 'endable';
}

export function recomputePhase(state) {
  if (state.pendingAction) {
    state.turn.phase = 'resolving';
  } else if (state.turn.phase === 'resolving') {
    state.turn.phase = 'endable';
  }
}

// ---------- DEBT ----------
// Pay `amount` from debtor to creditor. If debtor can't pay, open settleDebt
// pendingAction; the player can then liquidate / trade / declare bankruptcy.
export function tryDebit(state, debtorSeat, amount, source, log) {
  const debtor = state.seats[debtorSeat];
  if (debtor.cash >= amount) {
    debtor.cash = cents(debtor.cash - amount);
    if (source.type === 'rent' && typeof source.creditorSeat === 'number') {
      const c = state.seats[source.creditorSeat];
      c.cash = cents(c.cash + amount);
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

// After any cash-injecting action (sellHouse, sellPropertyToBank, executeTrade,
// transfer, etc.) attempt to settle an open debt automatically. No-op if there
// is no pending settleDebt or the debtor still doesn't have enough cash.
export function tryAutoSettle(state, log) {
  const pa = state.pendingAction;
  if (!pa || pa.type !== 'settleDebt') return;
  const debtor = state.seats[pa.debtorSeat];
  if (debtor.cash < pa.amount) return;
  debtor.cash = cents(debtor.cash - pa.amount);
  if (pa.creditor.kind === 'player') {
    const c = state.seats[pa.creditor.seat];
    c.cash = cents(c.cash + pa.amount);
  } else if (pa.source?.type === 'chairman') {
    for (const r of pa.source.recipients) {
      const recipient = state.seats[r];
      recipient.cash = cents(recipient.cash + pa.source.perPlayer);
    }
  }
  log('debtSettled', pa.debtorSeat, { amount: pa.amount, creditor: pa.creditor });
  state.pendingAction = null;
  recomputePhase(state);
}

// When a stock's deck reshuffles, its wildcards are re-randomized. Insider-tip
// reveals on the prior wildcards are stale and must be dropped from every seat
// that knew them. The reveal is symbol-scoped, so reveals for un-reshuffled
// stocks are left intact.
export function clearStaleWildcardReveals(state, reshuffledSymbols) {
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
