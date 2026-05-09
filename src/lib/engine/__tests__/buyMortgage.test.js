import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng } from './helpers.js';
import { BUY_MORTGAGE_PTR } from '../../shared/constants.js';
import { MISSED_PAYMENT_CREDIT_PENALTY } from '../../shared/reserve/loanCatalog.js';

function step(state, action, ctx = { rng: makeRng() }) {
  const r = reducer(state, action, ctx);
  if (!r.ok) throw new Error('reducer error: ' + r.error);
  return r.state;
}

function withBuyDecision(seatIndex = 0, spaceIndex = 1, price = 60) {
  const s = makeRoom(2);
  s.seats[seatIndex].position = spaceIndex;
  s.pendingAction = { type: 'buyDecision', seat: seatIndex, spaceIndex, price };
  s.turn = { seat: seatIndex, phase: 'resolving', lastRoll: [3, 5], doublesCount: 0 };
  return s;
}

test('buyPropertyWithMortgage term 5 transfers ownership and mints loan with correct math', () => {
  let s = withBuyDecision(0, 1, 60);
  const cashBefore = s.seats[0].cash;
  s = step(s, { type: 'buyPropertyWithMortgage', seat: 0, term: 5 });
  assert.equal(s.properties[1].ownerSeat, 0);
  assert.equal(s.properties[1].mortgaged, false);
  assert.equal(s.seats[0].cash, cashBefore, 'cash should not change');
  assert.equal(s.pendingAction, null);
  assert.equal(s.turn.phase, 'endable');

  assert.equal(s.seats[0].loans.length, 1);
  const loan = s.seats[0].loans[0];
  assert.equal(loan.source, 'mortgage');
  assert.equal(loan.propertyIndex, 1);
  assert.equal(loan.principal, 60);
  assert.equal(loan.term, 5);
  assert.equal(loan.ptr, 0.10);
  assert.equal(loan.totalDebt, 90);
  assert.equal(loan.installment, 18);
  assert.equal(loan.balance, 90);
  assert.equal(loan.paymentsMade, 0);
  assert.equal(loan.status, 'active');
  assert.equal(loan.dueThisTurn, false);
  assert.equal(typeof loan.propertyName, 'string');
});

test('buyPropertyWithMortgage term 10 produces totalDebt 120, installment 12', () => {
  let s = withBuyDecision(0, 1, 60);
  s = step(s, { type: 'buyPropertyWithMortgage', seat: 0, term: 10 });
  const loan = s.seats[0].loans[0];
  assert.equal(loan.term, 10);
  assert.equal(loan.totalDebt, 120);
  assert.equal(loan.installment, 12);
});

test('buyPropertyWithMortgage rejects bad terms', () => {
  for (const badTerm of [3, 7, 8, 0, 'foo', null, undefined, -5]) {
    const s = withBuyDecision(0, 1, 60);
    const r = reducer(s, { type: 'buyPropertyWithMortgage', seat: 0, term: badTerm }, { rng: makeRng() });
    assert.equal(r.ok, false, `term ${badTerm} should be rejected`);
    assert.equal(r.error, 'BAD_TERM');
  }
});

test('buyPropertyWithMortgage rejects Poor-tier seat (creditScore < 580)', () => {
  const s = withBuyDecision(0, 1, 60);
  s.seats[0].creditScore = 450;
  const r = reducer(s, { type: 'buyPropertyWithMortgage', seat: 0, term: 5 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NOT_ELIGIBLE');
  assert.equal(s.properties[1].ownerSeat, null);
});

test('buyPropertyWithMortgage allows Fair-tier (creditScore = 580)', () => {
  let s = withBuyDecision(0, 1, 60);
  s.seats[0].creditScore = 580;
  s = step(s, { type: 'buyPropertyWithMortgage', seat: 0, term: 5 });
  assert.equal(s.properties[1].ownerSeat, 0);
  assert.equal(s.seats[0].loans.length, 1);
});

test('buyPropertyWithMortgage rejects when no buyDecision is pending', () => {
  const s = makeRoom(2);
  const r = reducer(s, { type: 'buyPropertyWithMortgage', seat: 0, term: 5 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NO_BUY_DECISION');
});

test('buyPropertyWithMortgage rejects when wrong seat responds', () => {
  const s = withBuyDecision(0, 1, 60);
  const r = reducer(s, { type: 'buyPropertyWithMortgage', seat: 1, term: 5 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NOT_YOUR_DECISION');
});

test('buyPropertyWithMortgage rejects spaceIndex mismatch (stale client click)', () => {
  const s = withBuyDecision(0, 1, 60);
  const r = reducer(s, {
    type: 'buyPropertyWithMortgage', seat: 0, term: 5, spaceIndex: 3
  }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'SPACE_MISMATCH');
});

test('buyPropertyWithMortgage rejects bankrupt seat', () => {
  const s = withBuyDecision(0, 1, 60);
  s.seats[0].bankrupt = true;
  const r = reducer(s, { type: 'buyPropertyWithMortgage', seat: 0, term: 5 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'BANKRUPT');
});

test('mortgage loan rides existing loan plumbing — installment due at next turn, payable, balance reduces', () => {
  let s = withBuyDecision(0, 1, 60);
  s = step(s, { type: 'buyPropertyWithMortgage', seat: 0, term: 5 });
  const loanId = s.seats[0].loans[0].id;

  // End seat 0's turn. Since lastRoll is non-doubles ([3,5]), advances to seat 1.
  s = step(s, { type: 'endTurn', seat: 0 });
  // End seat 1's turn to come back to seat 0.
  s.turn = { seat: 1, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s = step(s, { type: 'endTurn', seat: 1 });

  // Back at seat 0's turn-start: the loan should now be due.
  assert.equal(s.turn.seat, 0);
  const due = s.seats[0].loans[0];
  assert.equal(due.dueThisTurn, true);
  assert.equal(s.seats[0].loanTurnResponded, false);

  // Capture cash AFTER turn-start hooks (HYSA interest etc.) so we can isolate
  // the installment debit.
  const cashBeforePay = s.seats[0].cash;
  s = step(s, { type: 'payLoanInstallment', seat: 0, loanId });
  const paid = s.seats[0].loans[0];
  assert.equal(paid.dueThisTurn, false);
  assert.equal(paid.paymentsMade, 1);
  assert.equal(paid.balance, 72); // 90 - 18
  assert.equal(s.seats[0].cash, cashBeforePay - 18);
  assert.equal(s.seats[0].loanTurnResponded, true);
});

test('mortgage loan installment can be skipped — applies credit-score penalty', () => {
  let s = withBuyDecision(0, 1, 60);
  s = step(s, { type: 'buyPropertyWithMortgage', seat: 0, term: 5 });
  const loanId = s.seats[0].loans[0].id;
  const scoreBefore = s.seats[0].creditScore;

  s = step(s, { type: 'endTurn', seat: 0 });
  s.turn = { seat: 1, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s = step(s, { type: 'endTurn', seat: 1 });

  s = step(s, { type: 'skipLoanInstallment', seat: 0, loanId });
  assert.equal(s.seats[0].creditScore, scoreBefore - MISSED_PAYMENT_CREDIT_PENALTY);
  // Skipped → balance unchanged, paymentsMade NOT incremented.
  assert.equal(s.seats[0].loans[0].balance, 90);
  assert.equal(s.seats[0].loans[0].paymentsMade, 0);
});

test('property is not flagged property.mortgaged after buy-with-mortgage', () => {
  let s = withBuyDecision(0, 1, 60);
  s = step(s, { type: 'buyPropertyWithMortgage', seat: 0, term: 10 });
  assert.equal(s.properties[1].mortgaged, false);
  assert.equal(s.properties[1].ownerSeat, 0);
  assert.equal(s.properties[1].houses, 0);
});

test('uses the configured BUY_MORTGAGE_PTR (regression guard if constant changes)', () => {
  let s = withBuyDecision(0, 1, 100);
  s = step(s, { type: 'buyPropertyWithMortgage', seat: 0, term: 5 });
  const loan = s.seats[0].loans[0];
  assert.equal(loan.ptr, BUY_MORTGAGE_PTR);
});
