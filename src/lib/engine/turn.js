import { nextActiveSeatAfter } from './selectors.js';

// Reset turn metadata for the new active seat.
export function startNewTurn(state, seatIndex) {
  state.turn = {
    seat: seatIndex,
    phase: 'preRoll',
    lastRoll: null,
    doublesCount: 0
  };
}

export function advanceTurn(state) {
  const next = nextActiveSeatAfter(state, state.turn.seat);
  if (next == null) {
    state.phase = 'finished';
    return;
  }
  startNewTurn(state, next);
}
