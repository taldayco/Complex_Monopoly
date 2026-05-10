import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng, giveProperty } from './helpers.js';

function step(state, action, ctx) {
  const r = reducer(state, action, ctx);
  if (!r.ok) throw new Error('reducer error: ' + r.error);
  return r.state;
}

test('rolling moves the seat and offers buy on unowned property', () => {
  let s = makeRoom(2);
  // Force a known dice via custom rng. seed gives a particular sequence.
  // Instead just inject an rng that returns known values.
  let rolls = [0.0, 0.34]; // floor(0.0*6)+1=1, floor(0.34*6)+1=3 → total 4 → land on space 4 (Income Tax). Bad.
  // Let me use 0.0 and 0.0 → 1+1=2 → space 2 (Community Chest). Also no buy.
  // Use 0.34 and 0.0 → 3+1=4 → tax. Hmm.
  // Try 0.0 and 0.5 → 1+4=5 → Reading Railroad. Good.
  rolls = [0.0, 0.5];
  let i = 0;
  const rng = () => rolls[i++ % rolls.length];

  s = step(s, { type: 'rollDice', seat: 0 }, { rng });
  assert.equal(s.seats[0].position, 5);
  assert.equal(s.pendingAction?.type, 'buyDecision');
  assert.equal(s.pendingAction?.spaceIndex, 5);
});

test('buying clears pending and reduces cash', () => {
  let s = makeRoom(2);
  // Place player 0 at start; manually set up a buy decision.
  s.seats[0].position = 1;
  s.pendingAction = {
    type: 'buyDecision',
    seat: 0,
    spaceIndex: 1,
    price: 60
  };
  s.turn.phase = 'resolving';
  s = step(s, { type: 'buyProperty', seat: 0 }, { rng: makeRng() });
  assert.equal(s.pendingAction, null);
  assert.equal(s.seats[0].cash, 1500 - 60);
  assert.equal(s.properties[1].ownerSeat, 0);
  assert.equal(s.turn.phase, 'endable');
});

test('declining queues a pending auction (no live auction yet)', () => {
  let s = makeRoom(2);
  s.pendingAction = { type: 'buyDecision', seat: 0, spaceIndex: 1, price: 60 };
  s.turn.phase = 'resolving';
  s = step(s, { type: 'declineToBuy', seat: 0 }, { rng: makeRng() });
  // Auction does NOT start immediately — it's queued for end-of-turn.
  assert.equal(s.pendingAction, null);
  assert.equal(s.pendingAuctions.length, 1);
  assert.equal(s.pendingAuctions[0].spaceIndex, 1);
  assert.equal(s.pendingAuctions[0].declinedBy, 0);
  assert.equal(s.pendingAuctions[0].reason, 'declined');
  // Turn becomes endable so the player can press End Turn.
  assert.equal(s.turn.phase, 'endable');
});

test('rent: landing on owned property pays rent', () => {
  let s = makeRoom(2);
  // P1 owns Mediterranean (index 1).
  giveProperty(s, 1, 1);
  // Force P0's roll to land on Mediterranean: total 1.
  // 1 die can't be 1 — minimum is 2 (1+1 → doubles). So we need doubles for total=1, impossible.
  // Use total 1 via... actually impossible. Skip rolling and just set position + apply.
  // Instead: have P0 at position 0, set pendingAction to indicate landing already done? Easier:
  // Just construct state where P0 lands on idx 1 via reducer rolling (1+0 impossible).
  // Use doubles roll (1+1=2 lands on space 2 = Community Chest). Doesn't help.
  // Use roll [3, 7] impossible. Instead:
  // Place seat at 39 (Boardwalk), roll 1+1=2 doubles → wraps to 1 (Mediterranean). YES.
  s.seats[0].position = 39;
  const rng = () => 0; // 1+1 = doubles, total 2, advances to 1 (Mediterranean), passes GO
  s = step(s, { type: 'rollDice', seat: 0 }, { rng });
  assert.equal(s.seats[0].position, 1);
  assert.equal(s.seats[0].cash, 1500 + 100 - 2);
  assert.equal(s.seats[1].cash, 1500 + 2);
});

test('three doubles sends to jail', () => {
  let s = makeRoom(2);
  s.turn.doublesCount = 2;
  // Make a dice-rolling rng that returns doubles (both same).
  const rng = () => 0.0; // floor(0*6)+1 = 1 → 1+1 doubles
  s = step(s, { type: 'rollDice', seat: 0 }, { rng });
  assert.equal(s.seats[0].inJail, true);
  assert.equal(s.seats[0].position, 10);
  assert.equal(s.turn.phase, 'endable');
});

test('end turn advances to next player', () => {
  let s = makeRoom(3);
  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s = step(s, { type: 'endTurn', seat: 0 }, { rng: makeRng() });
  assert.equal(s.turn.seat, 1);
  assert.equal(s.turn.phase, 'preRoll');
});

test('end turn with doubles allows another roll', () => {
  let s = makeRoom(2);
  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 3], lastRollWasDoubles: true, doublesCount: 1 };
  s = step(s, { type: 'endTurn', seat: 0 }, { rng: makeRng() });
  assert.equal(s.turn.seat, 0);
  assert.equal(s.turn.phase, 'preRoll');
});

test('passing GO collects $200', () => {
  let s = makeRoom(2);
  s.seats[0].position = 38;
  const rng = () => 0.34; // 3 + 3 = doubles, total 6 → wraps to 4 (Market Open)
  s = step(s, { type: 'rollDice', seat: 0 }, { rng });
  assert.equal(s.seats[0].position, 4);
  assert.equal(s.seats[0].cash, 1600);
});

test('original doubles + utility-card overwrite still grants the bonus turn', () => {
  let s = makeRoom(2);
  s.turn = {
    seat: 0,
    phase: 'endable',
    lastRoll: [3, 4],
    lastRollWasDoubles: true,
    doublesCount: 1
  };
  s = step(s, { type: 'endTurn', seat: 0 }, { rng: makeRng() });
  assert.equal(s.turn.seat, 0, 'same seat — bonus turn');
  assert.equal(s.turn.phase, 'preRoll');
});

test('non-doubles original + utility-card rolling accidental doubles does NOT grant bonus', () => {
  let s = makeRoom(2);
  s.turn = {
    seat: 0,
    phase: 'endable',
    lastRoll: [4, 4],
    lastRollWasDoubles: false,
    doublesCount: 0
  };
  s = step(s, { type: 'endTurn', seat: 0 }, { rng: makeRng() });
  assert.notEqual(s.turn.seat, 0, 'turn advanced — no bonus');
});

test('jail-exit doubles do NOT grant a bonus turn at end of turn', () => {
  let s = makeRoom(2);
  s.turn = {
    seat: 0,
    phase: 'endable',
    lastRoll: [5, 5],
    lastRollWasDoubles: false,
    doublesCount: 0
  };
  s = step(s, { type: 'endTurn', seat: 0 }, { rng: makeRng() });
  assert.notEqual(s.turn.seat, 0, 'turn advanced — no jail-doubles bonus');
});
