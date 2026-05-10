import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng } from './helpers.js';
import {
  calcLoanOptions,
  getTierByScore,
  LOAN_TERMS,
  MISSED_PAYMENT_CREDIT_PENALTY
} from '../../shared/reserve/loanCatalog.js';

function step(state, action, ctx = { rng: makeRng() }) {
  const r = reducer(state, action, ctx);
  if (!r.ok) throw new Error('reducer error: ' + r.error);
  return r.state;
}

// ---------- catalog ----------

test('getTierByScore returns correct tier for boundaries', () => {
  assert.equal(getTierByScore(0).name, 'Very Poor');
  assert.equal(getTierByScore(300).name, 'Very Poor');
  assert.equal(getTierByScore(349).name, 'Very Poor');
  assert.equal(getTierByScore(350).name, 'Poor');
  assert.equal(getTierByScore(579).name, 'Poor');
  assert.equal(getTierByScore(580).name, 'Fair');
  assert.equal(getTierByScore(669).name, 'Fair');
  assert.equal(getTierByScore(670).name, 'Good');
  assert.equal(getTierByScore(739).name, 'Good');
  assert.equal(getTierByScore(740).name, 'Very Good');
  assert.equal(getTierByScore(799).name, 'Very Good');
  assert.equal(getTierByScore(800).name, 'Excellent');
  assert.equal(getTierByScore(850).name, 'Excellent');
});

test('calcLoanOptions returns 3 term offers, dice raises PTR monotonically', () => {
  const o1 = calcLoanOptions(720, 100, 1);
  const o6 = calcLoanOptions(720, 100, 6);
  assert.equal(o1.options.length, LOAN_TERMS.length);
  for (let i = 0; i < o1.options.length; i++) {
    assert.equal(o1.options[i].term, LOAN_TERMS[i]);
    assert.ok(o6.options[i].ptr > o1.options[i].ptr, 'roll 6 should be a worse rate than roll 1');
  }
});

test('calcLoanOptions returns null for Poor tier (no eligibility)', () => {
  assert.equal(calcLoanOptions(450, 100, 1), null);
});

// ---------- request / accept / decline ----------

test('requestLoan: rejects amount over dynamic max line', () => {
  const s = makeRoom(2);
  s.seats[0].creditScore = 720;
  s.seats[0].cash = 200;
  const r = reducer(s, { type: 'requestLoan', seat: 0, amount: 5000 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'EXCEEDS_MAX_LINE');
});

test('requestLoan: rejects principal below $100 minimum', () => {
  const s = makeRoom(2);
  s.seats[0].creditScore = 720;
  const r = reducer(s, { type: 'requestLoan', seat: 0, amount: 50 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'PRINCIPAL_BELOW_MIN');
});

test('requestLoan: rejects sub-zero amount', () => {
  const s = makeRoom(2);
  const r = reducer(s, { type: 'requestLoan', seat: 0, amount: 0 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'BAD_AMOUNT');
});

test('requestLoan: stores pendingLoanOffer with three options', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 720;
  s = step(s, { type: 'requestLoan', seat: 0, amount: 200 });
  const offer = s.seats[0].pendingLoanOffer;
  assert.ok(offer);
  assert.equal(offer.principal, 200);
  assert.equal(offer.options.length, 3);
});

test('requestLoan: rejects when an offer is already pending', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 720;
  s = step(s, { type: 'requestLoan', seat: 0, amount: 100 });
  const r = reducer(s, { type: 'requestLoan', seat: 0, amount: 100 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'OFFER_PENDING');
});

test('respondLoanOffer accept: deposits principal, creates active loan, clears offer', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 720;
  const startCash = s.seats[0].cash;
  s = step(s, { type: 'requestLoan', seat: 0, amount: 200 });
  const term = s.seats[0].pendingLoanOffer.options[0].term;
  s = step(s, { type: 'respondLoanOffer', seat: 0, term });

  assert.equal(s.seats[0].pendingLoanOffer, null);
  assert.equal(s.seats[0].loans.length, 1);
  const loan = s.seats[0].loans[0];
  assert.equal(loan.status, 'active');
  assert.equal(loan.principal, 200);
  assert.equal(loan.term, term);
  assert.equal(loan.balance, loan.totalDebt);
  assert.equal(s.seats[0].cash, startCash + 200);
});

test('respondLoanOffer decline: clears offer, no loan created', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 720;
  s = step(s, { type: 'requestLoan', seat: 0, amount: 100 });
  s = step(s, { type: 'respondLoanOffer', seat: 0, decline: true });
  assert.equal(s.seats[0].pendingLoanOffer, null);
  assert.equal(s.seats[0].loans.length, 0);
});

// ---------- turn hooks ----------

test('endTurn marks active loans due for the next seat; rollDice blocks until response', () => {
  let s = makeRoom(2);
  s.seats[1].creditScore = 720;
  // Seat 1 takes a loan during seat 0's turn (non-blocking action). We just
  // create the loan directly to keep this test focused on the turn hook.
  s.seats[1].loans.push({
    id: 'L-test',
    principal: 100,
    term: 3,
    ptr: 0.05,
    totalDebt: 115,
    installment: 38.33,
    paymentsMade: 0,
    balance: 115,
    takenAt: 0,
    dueThisTurn: false,
    status: 'active'
  });
  // End seat 0's turn → seat 1 becomes current and the loan should be marked due.
  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s = step(s, { type: 'endTurn', seat: 0 });

  assert.equal(s.turn.seat, 1);
  assert.equal(s.seats[1].loans[0].dueThisTurn, true);
  assert.equal(s.seats[1].loanTurnResponded, false);

  // Roll should now be blocked.
  const roll = reducer(s, { type: 'rollDice', seat: 1 }, { rng: makeRng() });
  assert.equal(roll.ok, false);
  assert.equal(roll.error, 'LOAN_DUE');
});

test('payLoanInstallment: deducts cash, increments paymentsMade, reduces balance, unblocks rolling', () => {
  let s = makeRoom(2, { cash: 500 });
  s.seats[0].loans.push({
    id: 'L-pay',
    principal: 100,
    term: 3,
    ptr: 0.05,
    totalDebt: 115,
    installment: 38.33,
    paymentsMade: 0,
    balance: 115,
    takenAt: 0,
    dueThisTurn: true,
    status: 'active'
  });
  s.seats[0].loanTurnResponded = false;
  s = step(s, { type: 'payLoanInstallment', seat: 0, loanId: 'L-pay' });
  const loan = s.seats[0].loans[0];
  assert.equal(loan.paymentsMade, 1);
  assert.equal(loan.dueThisTurn, false);
  assert.ok(Math.abs(loan.balance - (115 - 38.33)) < 0.01);
  assert.equal(s.seats[0].cash, 500 - 38.33);
  assert.equal(s.seats[0].loanTurnResponded, true);
});

test('skipLoanInstallment: applies credit-score penalty, balance unchanged', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 720;
  s.seats[0].loans.push({
    id: 'L-skip',
    principal: 100,
    term: 3,
    ptr: 0.05,
    totalDebt: 115,
    installment: 38.33,
    paymentsMade: 0,
    balance: 115,
    takenAt: 0,
    dueThisTurn: true,
    status: 'active'
  });
  s.seats[0].loanTurnResponded = false;
  s = step(s, { type: 'skipLoanInstallment', seat: 0, loanId: 'L-skip' });
  assert.equal(s.seats[0].creditScore, 720 - MISSED_PAYMENT_CREDIT_PENALTY);
  assert.equal(s.seats[0].loans[0].balance, 115);
  assert.equal(s.seats[0].loans[0].paymentsMade, 0);
  assert.equal(s.seats[0].loans[0].dueThisTurn, false);
  assert.equal(s.seats[0].loanTurnResponded, true);
});

test('payoffLoan: pays full balance and closes the loan', () => {
  let s = makeRoom(2, { cash: 500 });
  s.seats[0].loans.push({
    id: 'L-off',
    principal: 100,
    term: 3,
    ptr: 0.05,
    totalDebt: 115,
    installment: 38.33,
    paymentsMade: 0,
    balance: 115,
    takenAt: 0,
    dueThisTurn: false,
    status: 'active'
  });
  s = step(s, { type: 'payoffLoan', seat: 0, loanId: 'L-off' });
  assert.equal(s.seats[0].loans[0].status, 'closed');
  assert.equal(s.seats[0].loans[0].balance, 0);
  assert.equal(s.seats[0].cash, 500 - 115);
});
