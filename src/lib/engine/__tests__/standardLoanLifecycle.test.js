import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng, step } from './helpers.js';
import {
  calcLoanOptions,
  calcMaxStandardLoan,
  PTR_BY_TIER_AND_DICE,
  TERM_PREMIUM,
  STANDARD_LOAN_APPLY_CREDIT_PENALTY,
  STANDARD_LOAN_ANTI_HACK_BONUS,
  STANDARD_LOAN_MIN_PRINCIPAL,
  STANDARD_LOANS_PER_TURN,
  clampCreditScore
} from '../../shared/reserve/loanCatalog.js';

test('PTR table matches spec per tier per dice pip', () => {
  assert.deepEqual(PTR_BY_TIER_AND_DICE.Excellent, [0.03, 0.035, 0.04, 0.045, 0.05, 0.055]);
  assert.deepEqual(PTR_BY_TIER_AND_DICE['Very Good'], [0.06, 0.065, 0.07, 0.075, 0.08, 0.085]);
  assert.deepEqual(PTR_BY_TIER_AND_DICE.Good, [0.09, 0.095, 0.10, 0.105, 0.11, 0.115]);
  assert.deepEqual(PTR_BY_TIER_AND_DICE.Fair, [0.10, 0.11, 0.12, 0.13, 0.14, 0.15]);
});

test('term premium adds (not subtracts) per spec: 3=+0%, 5=+1%, 8=+2%', () => {
  assert.equal(TERM_PREMIUM[3], 0);
  assert.equal(TERM_PREMIUM[5], 0.01);
  assert.equal(TERM_PREMIUM[8], 0.02);
  const opts = calcLoanOptions(800, 100, 1);
  assert.equal(opts.options[0].ptr, 0.03);
  assert.equal(opts.options[1].ptr, 0.04);
  assert.equal(opts.options[2].ptr, 0.05);
});

test('Poor and Very Poor tiers ineligible for standard loans', () => {
  assert.equal(calcLoanOptions(320, 100, 1), null);
  assert.equal(calcLoanOptions(450, 100, 1), null);
});

test('calcMaxStandardLoan: dynamic formula = (cash + bank - loans) × tierMult, rounded $50', () => {
  const seat = { cash: 1000, creditScore: 720 };
  assert.equal(calcMaxStandardLoan(seat), 1750);
});

test('calcMaxStandardLoan: subtracts active loan balances', () => {
  const seat = {
    cash: 1000,
    creditScore: 720,
    loans: [{ status: 'active', balance: 400 }]
  };
  assert.equal(calcMaxStandardLoan(seat), 1050);
});

test('calcMaxStandardLoan: includes open bank balances in base', () => {
  const seat = {
    cash: 500,
    creditScore: 720,
    bankAccounts: {
      mmcu: { open: true, balance: 500 },
      boardwalk: { open: false, balance: 0 }
    }
  };
  assert.equal(calcMaxStandardLoan(seat), 1750);
});

test('calcMaxStandardLoan: card line bonus is multiplicative', () => {
  const seat = { cash: 1000, creditScore: 720 };
  assert.equal(calcMaxStandardLoan(seat, { cardLineBonus: 0.4 }), 2450);
});

test('calcMaxStandardLoan: Very Poor and Poor return 0', () => {
  assert.equal(calcMaxStandardLoan({ cash: 1000, creditScore: 320 }), 0);
  assert.equal(calcMaxStandardLoan({ cash: 1000, creditScore: 450 }), 0);
});

test('requestLoan: rejects principal below $100 minimum', () => {
  const s = makeRoom(2);
  s.seats[0].creditScore = 720;
  const r = reducer(s, { type: 'requestLoan', seat: 0, amount: STANDARD_LOAN_MIN_PRINCIPAL - 1 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'PRINCIPAL_BELOW_MIN');
});

test('requestLoan: rejects 6th loan in same turn (max 5/turn)', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 800;
  s.seats[0].cash = 5000;
  for (let i = 0; i < STANDARD_LOANS_PER_TURN; i++) {
    s = step(s, { type: 'requestLoan', seat: 0, amount: 100 });
    s = step(s, { type: 'respondLoanOffer', seat: 0, term: 3 });
  }
  const r = reducer(s, { type: 'requestLoan', seat: 0, amount: 100 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'LOANS_PER_TURN_EXCEEDED');
});

test('respondLoanOffer accept: applies -50 credit penalty and tracks creditPenaltyApplied', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 720;
  const before = s.seats[0].creditScore;
  s = step(s, { type: 'requestLoan', seat: 0, amount: 200 });
  s = step(s, { type: 'respondLoanOffer', seat: 0, term: 3 });
  assert.equal(s.seats[0].creditScore, before - STANDARD_LOAN_APPLY_CREDIT_PENALTY);
  assert.equal(s.seats[0].loans[0].creditPenaltyApplied, STANDARD_LOAN_APPLY_CREDIT_PENALTY);
});

test('payoffLoan: refunds the apply credit penalty back', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 720;
  s.seats[0].cash = 5000;
  s = step(s, { type: 'requestLoan', seat: 0, amount: 100 });
  s = step(s, { type: 'respondLoanOffer', seat: 0, term: 3 });
  const afterApply = s.seats[0].creditScore;
  const loanId = s.seats[0].loans[0].id;
  s = step(s, { type: 'payoffLoan', seat: 0, loanId });
  assert.equal(s.seats[0].creditScore, afterApply + STANDARD_LOAN_APPLY_CREDIT_PENALTY);
  assert.equal(s.seats[0].loans[0].creditPenaltyApplied, 0);
});

test('anti-credit-hack: paying exact installment on time grants +5 once per turn per loan', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 720;
  s.seats[0].cash = 5000;
  s = step(s, { type: 'requestLoan', seat: 0, amount: 100 });
  s = step(s, { type: 'respondLoanOffer', seat: 0, term: 8 });
  const loanId = s.seats[0].loans[0].id;
  s.seats[0].loans[0].dueThisTurn = true;
  s.seats[0].loans[0].creditCreditedThisTurn = false;
  const before = s.seats[0].creditScore;
  s = step(s, { type: 'payLoanInstallment', seat: 0, loanId });
  assert.equal(s.seats[0].creditScore, before + STANDARD_LOAN_ANTI_HACK_BONUS);
  assert.equal(s.seats[0].loans[0].creditCreditedThisTurn, true);
});

test('anti-credit-hack: cannot stack +5 on the same loan within one turn', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 720;
  s.seats[0].cash = 5000;
  s = step(s, { type: 'requestLoan', seat: 0, amount: 100 });
  s = step(s, { type: 'respondLoanOffer', seat: 0, term: 8 });
  const loanId = s.seats[0].loans[0].id;
  s.seats[0].loans[0].dueThisTurn = true;
  s.seats[0].loans[0].creditCreditedThisTurn = false;
  s = step(s, { type: 'payLoanInstallment', seat: 0, loanId });
  const afterFirst = s.seats[0].creditScore;
  s.seats[0].loans[0].dueThisTurn = true;
  const r = reducer(s, { type: 'payLoanInstallment', seat: 0, loanId }, { rng: makeRng() });
  assert.equal(r.ok, true);
  assert.equal(r.state.seats[0].creditScore, afterFirst);
});

test('startNewTurn resets standardLoansThisTurn and clears anti-hack flag per loan', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 800;
  s.seats[0].cash = 1000;
  s = step(s, { type: 'requestLoan', seat: 0, amount: 100 });
  s = step(s, { type: 'respondLoanOffer', seat: 0, term: 3 });
  s.seats[0].loans[0].creditCreditedThisTurn = true;
  assert.equal(s.seats[0].standardLoansThisTurn, 1);
  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s = step(s, { type: 'endTurn', seat: 0 });
  assert.equal(s.turn.seat, 1);
  s.turn = { seat: 1, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s = step(s, { type: 'endTurn', seat: 1 });
  assert.equal(s.seats[0].standardLoansThisTurn, 0);
  assert.equal(s.seats[0].loans[0].creditCreditedThisTurn, false);
});

test('clampCreditScore floors at 300 and ceilings at 850', () => {
  assert.equal(clampCreditScore(100), 300);
  assert.equal(clampCreditScore(1200), 850);
  assert.equal(clampCreditScore(720), 720);
  assert.equal(clampCreditScore(NaN), 300);
});
