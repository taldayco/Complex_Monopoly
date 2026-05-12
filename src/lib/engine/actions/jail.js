// Jail actions: try to leave (card / fine / roll), and pick which property to
// surrender on a three-doubles seizure.

import { attemptJailExit, seizePropertyToBank } from '../jail.js';
import { advancePosition } from '../movement.js';
import { inflatedSalary } from '../../shared/economy/inflation.js';
import { returnCardToDiscard } from '../cards.js';
import { isCurrentSeat } from '../_helpers.js';
import { applyGoCardBonuses, resolveLanding } from '../landing.js';

export function doUseGetOutOfJail(state, action, ctx, log) {
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

export function doPayJailFine(state, action, ctx, log) {
  if (!isCurrentSeat(state, action)) return { error: 'NOT_YOUR_TURN' };
  if (state.turn.phase !== 'preRoll') return { error: 'BAD_PHASE' };
  const seat = state.seats[action.seat];
  const r = attemptJailExit(state, seat, 'pay', ctx.rng);
  if (r.error) return { error: r.error };
  log('jailFinePaid', action.seat, null);
  return {};
}

export function doRollForJail(state, action, ctx, log) {
  if (!isCurrentSeat(state, action)) return { error: 'NOT_YOUR_TURN' };
  if (state.turn.phase !== 'preRoll') return { error: 'BAD_PHASE' };
  const seat = state.seats[action.seat];
  const r = attemptJailExit(state, seat, 'roll', ctx.rng);
  if (r.error) return { error: r.error };
  state.rngCursor++;
  state.turn.lastRoll = [r.roll.d1, r.roll.d2];
  state.turn.lastRollWasDoubles = r.released && r.roll.doubles;
  if (state.turn.lastRollWasDoubles) state.turn.doublesCount++;
  log('jailRoll', action.seat, { d1: r.roll.d1, d2: r.roll.d2, released: r.released });

  if (r.released) {
    // If they paid on the third turn (mustPay), don't grant doubles bonus turn.
    const { passedGo } = advancePosition(state, seat, r.roll.total);
    if (passedGo) log('passGo', action.seat, { amount: inflatedSalary(state) });
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

export function doChooseJailSeizure(state, action, ctx, log) {
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
