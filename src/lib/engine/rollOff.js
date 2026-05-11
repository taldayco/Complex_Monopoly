// Pre-game roll-off: every seat rolls dice; highest total picks the turn order
// (winner becomes seat 0). Ties trigger a re-roll among the tied seats only.
//
// Two exported entry points:
//   doRollForOrder — handler for the `rollForOrder` action.
//   finalizeRollOff — applied once a unique winner is identified; rotates the
//     seats array so the winner sits at index 0 and starts the playing phase.

import { rollDice as rollDiceFn } from './movement.js';

export function doRollForOrder(state, action, ctx, log) {
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

export function finalizeRollOff(state, winnerSeat, winnerTotal, log) {
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
