import { nextActiveSeatAfter } from './selectors.js';

export function startNewTurn(state, seatIndex) {
  state.turn = {
    seat: seatIndex,
    phase: 'preRoll',
    lastRoll: null,
    lastRollWasDoubles: false,
    doublesCount: 0
  };
  const seat = state.seats?.[seatIndex];
  if (seat) {
    seat.standardLoansThisTurn = 0;
    if (Array.isArray(seat.loans)) {
      for (const l of seat.loans) {
        if (l) l.creditCreditedThisTurn = false;
      }
    }
    if (Array.isArray(seat.mortgageLoans)) {
      for (const l of seat.mortgageLoans) {
        if (l) l.creditCreditedThisTurn = false;
      }
    }
  }
}

export function advanceTurn(state) {
  const next = nextActiveSeatAfter(state, state.turn.seat);
  if (next == null) {
    state.phase = 'finished';
    return;
  }
  startNewTurn(state, next);
}
