import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng, step } from './helpers.js';
import { calcLoanOptions } from '../../shared/reserve/loanCatalog.js';
import { BANKS } from '../../shared/reserve/economyCatalog.js';


test('calcLoanOptions adds reserveRate on top of base PTR', () => {
  const a = calcLoanOptions(900, 1000, 1);
  const b = calcLoanOptions(900, 1000, 1, { reserveRate: 0.04 });
  const term3a = a.options.find((o) => o.term === 3).ptr;
  const term3b = b.options.find((o) => o.term === 3).ptr;
  assert.equal(term3a, 0.03);
  assert.equal(term3b, 0.07);
});

test('calcLoanOptions subtracts boardwalkDiscount, floored at 0', () => {
  const r = calcLoanOptions(900, 1000, 1, { reserveRate: 0, boardwalkDiscount: 0.015 });
  assert.equal(r.options.find((o) => o.term === 3).ptr, 0.015);
});

test('calcLoanOptions PTR floors at 0 even with negative inputs', () => {
  const r = calcLoanOptions(900, 1000, 1, { reserveRate: 0, boardwalkDiscount: 1 });
  for (const o of r.options) {
    assert.ok(o.ptr >= 0, 'ptr must not be negative');
  }
});


test('requestLoan rejects Boardwalk bank for tier below Very Good', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 600;
  const r = reducer(s, { type: 'requestLoan', seat: 0, amount: 100, bank: 'boardwalk' }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'BOARDWALK_TIER_GATE');
});

test('requestLoan accepts Boardwalk for Very Good and above', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 800;
  const r = reducer(s, { type: 'requestLoan', seat: 0, amount: 500, bank: 'boardwalk' }, { rng: makeRng() });
  assert.equal(r.ok, true);
  const offer = r.events.find((e) => e.type === 'loanOffer');
  assert.ok(offer);
  assert.equal(offer.payload.bank, 'boardwalk');
});

test('requestLoan defaults to MMCU when bank arg omitted', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 720;
  const r = reducer(s, { type: 'requestLoan', seat: 0, amount: 100 }, { rng: makeRng() });
  assert.equal(r.ok, true);
  const offer = r.events.find((e) => e.type === 'loanOffer');
  assert.equal(offer.payload.bank, 'mmcu');
});


test('Boardwalk discount applied when seat is MM-clean', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 800;
  s.economy.reserveRate = 0;
  const r = reducer(s, { type: 'requestLoan', seat: 0, amount: 500, bank: 'boardwalk' }, { rng: makeRng(1) });
  const offer = r.events.find((e) => e.type === 'loanOffer');
  assert.equal(offer.payload.boardwalkDiscount, BANKS.boardwalk.loanDiscountIfMmFree);
});

test('Boardwalk discount NOT applied when seat has an active MM loan', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 800;
  s.economy.reserveRate = 0;
  s.seats[0].loans.push({ id: 'L', bank: 'mmcu', status: 'active', principal: 100, term: 3, ptr: 0.05, totalDebt: 115, installment: 38.33, paymentsMade: 0, balance: 115, takenAt: 0, dueThisTurn: false });
  const r = reducer(s, { type: 'requestLoan', seat: 0, amount: 500, bank: 'boardwalk' }, { rng: makeRng(1) });
  const offer = r.events.find((e) => e.type === 'loanOffer');
  assert.equal(offer.payload.boardwalkDiscount, 0);
});

test('Boardwalk discount NOT applied when seat has an active MM credit card', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 800;
  s.economy.reserveRate = 0;
  s.seats[0].creditCards.push({ id: 'CC', cardId: 'readingRail', status: 'active', acquiredAt: 0, balance: 0 });
  const r = reducer(s, { type: 'requestLoan', seat: 0, amount: 500, bank: 'boardwalk' }, { rng: makeRng(1) });
  const offer = r.events.find((e) => e.type === 'loanOffer');
  assert.equal(offer.payload.boardwalkDiscount, 0);
});


test('accepted loan PTR is frozen at issue and survives later reserveRate changes', () => {
  let s = makeRoom(2);
  s.seats[0].creditScore = 800;
  s.economy.reserveRate = 0.05;
  let state = step(s, { type: 'requestLoan', seat: 0, amount: 500, bank: 'mmcu' }, { rng: makeRng(2) });
  state = step(state, { type: 'respondLoanOffer', seat: 0, term: 3 }, { rng: makeRng(3) });
  const loanPtrAtIssue = state.seats[0].loans[0].ptr;
  state.economy.reserveRate = 0.1;
  assert.equal(state.seats[0].loans[0].ptr, loanPtrAtIssue);
  assert.equal(state.seats[0].loans[0].ptrAtIssue, loanPtrAtIssue);
  assert.equal(state.seats[0].loans[0].reserveRateAtIssue, 0.05);
});
