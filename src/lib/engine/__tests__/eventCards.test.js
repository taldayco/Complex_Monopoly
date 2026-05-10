import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../reducer.js';
import { makeRoom, makeRng } from './helpers.js';
import {
  applyEventCard,
  decayTempEffects,
  hasTempEffect
} from '../reserve/eventCards.js';
import { VOLATILE_STOCK_ORDER } from '../../shared/reserve/stockCatalog.js';

function step(state, action, ctx = { rng: makeRng() }) {
  const r = reducer(state, action, ctx);
  if (!r.ok) throw new Error('reducer error: ' + r.error);
  return r.state;
}

// ---------- decks initialise ----------

test('createInitialRoom populates reserveDecks with full card sets', () => {
  const s = makeRoom(2);
  assert.ok(s.reserveDecks.community.deck.length >= 10);
  assert.ok(s.reserveDecks.chance.deck.length >= 15);
});

// ---------- direct effect application ----------

test('applyEventCard cmty.insurance pays $200 cash', () => {
  const s = makeRoom(2);
  const before = s.seats[0].cash;
  const r = applyEventCard(s, 0, 'community', 'cmty.insurance', { rng: makeRng() }, () => {});
  assert.equal(r.ok, true);
  assert.equal(s.seats[0].cash, before + 200);
});

test('applyEventCard cmty.dividendMncl pays based on shares', () => {
  const s = makeRoom(2);
  s.seats[0].stockLots.MNCL = 10;
  const before = s.seats[0].cash;
  const price = s.stocks.market.MNCL.price;
  applyEventCard(s, 0, 'community', 'cmty.dividendMncl', { rng: makeRng() }, () => {});
  assert.equal(s.seats[0].cash, Math.round((before + 10 * price * 0.10) * 100) / 100);
});

test('applyEventCard cmty.inheritFp500 grants 1 share of every volatile stock', () => {
  const s = makeRoom(2);
  applyEventCard(s, 0, 'community', 'cmty.inheritFp500', { rng: makeRng() }, () => {});
  for (const sym of VOLATILE_STOCK_ORDER) {
    assert.equal(s.seats[0].stockLots[sym], 1);
  }
});

test('applyEventCard chance.crash30 moves all volatile stocks -30%', () => {
  const s = makeRoom(2);
  const before = Object.fromEntries(VOLATILE_STOCK_ORDER.map((sym) => [sym, s.stocks.market[sym].price]));
  applyEventCard(s, 0, 'chance', 'chance.crash30', { rng: makeRng() }, () => {});
  for (const sym of VOLATILE_STOCK_ORDER) {
    const next = s.stocks.market[sym].price;
    const expected = Math.max(0.01, Math.round(before[sym] * 0.7 * 100) / 100);
    assert.equal(next, expected);
  }
});

test('applyEventCard chance.specialLoan creates loan and deposits principal', () => {
  const s = makeRoom(2);
  const cashBefore = s.seats[0].cash;
  applyEventCard(s, 0, 'chance', 'chance.specialLoan', { rng: makeRng() }, () => {});
  assert.equal(s.seats[0].loans.length, 1);
  const loan = s.seats[0].loans[0];
  assert.equal(loan.principal, 1000);
  assert.equal(loan.term, 5);
  assert.equal(loan.ptr, 0.05);
  assert.equal(loan.totalDebt, 1250); // 1000 * (1 + 0.05*5)
  assert.equal(s.seats[0].cash, cashBefore + 1000);
});

test('applyEventCard chance.tempDoubleMaxLoan adds tempEffect', () => {
  const s = makeRoom(2);
  applyEventCard(s, 0, 'chance', 'chance.tempDoubleMaxLoan', { rng: makeRng() }, () => {});
  assert.equal(s.seats[0].tempEffects.length, 1);
  const e = s.seats[0].tempEffects[0];
  assert.equal(e.effectId, 'doubleMaxLine');
  assert.equal(e.expiresInTurns, 3);
});

test('applyEventCard cmty.bankPaysInstallment pays installment on existing loan', () => {
  const s = makeRoom(2);
  s.seats[0].loans.push({
    id: 'L-bp', principal: 100, term: 3, ptr: 0.05, totalDebt: 115,
    installment: 38.33, paymentsMade: 0, balance: 115,
    takenAt: 0, dueThisTurn: true, status: 'active'
  });
  applyEventCard(s, 0, 'community', 'cmty.bankPaysInstallment', { rng: makeRng() }, () => {});
  const loan = s.seats[0].loans[0];
  assert.equal(loan.paymentsMade, 1);
  assert.equal(loan.dueThisTurn, false);
});

// ---------- landing draws exactly one card per Chance/CC tile ----------

function rngForTotal(d1Target, d2Target) {
  let i = 0;
  return () => {
    const v = i === 0 ? (d1Target - 0.5) / 6 : (d2Target - 0.5) / 6;
    i++;
    return v;
  };
}

test('landing on Chance draws one legacy chance card; reserve deck untouched', () => {
  let s = makeRoom(2);
  s.seats[0].cash = 5000;
  s.seats[0].position = 0;
  s.turn = { seat: 0, phase: 'preRoll', lastRoll: null, doublesCount: 0 };
  const beforeReserveChance = s.reserveDecks.chance.deck.length;
  const beforeChance = s.chance.deck.length;
  s = step(s, { type: 'rollDice', seat: 0 }, { rng: rngForTotal(4, 3) });
  assert.equal(s.seats[0].position, 7);
  assert.equal(s.reserveDecks.chance.deck.length, beforeReserveChance);
  assert.equal(s.reserveDecks.chance.discard.length, 0);
  assert.equal(s.chance.deck.length + s.chance.discard.length, beforeChance);
});

test('landing on Community Chest draws one legacy CC card; reserve deck untouched', () => {
  let s = makeRoom(2);
  s.seats[0].cash = 5000;
  s.seats[0].position = 0;
  s.turn = { seat: 0, phase: 'preRoll', lastRoll: null, doublesCount: 0 };
  const beforeReserveCommunity = s.reserveDecks.community.deck.length;
  const beforeCommunity = s.communityChest.deck.length;
  s = step(s, { type: 'rollDice', seat: 0 }, { rng: rngForTotal(1, 1) });
  assert.equal(s.seats[0].position, 2);
  assert.equal(s.reserveDecks.community.deck.length, beforeReserveCommunity);
  assert.equal(s.reserveDecks.community.discard.length, 0);
  assert.equal(s.communityChest.deck.length + s.communityChest.discard.length, beforeCommunity);
});

test('flipEventCard action is no longer accepted (manual draw removed)', () => {
  const s = makeRoom(2);
  s.turn = { seat: 0, phase: 'preRoll', lastRoll: null, doublesCount: 0 };
  const r = reducer(s, { type: 'flipEventCard', seat: 0, deck: 'community' }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'UNKNOWN_ACTION');
});

test('dismissEventCard action is no longer accepted', () => {
  const s = makeRoom(2);
  s.turn = { seat: 0, phase: 'preRoll', lastRoll: null, doublesCount: 0 };
  const r = reducer(s, { type: 'dismissEventCard', seat: 0 }, { rng: makeRng() });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'UNKNOWN_ACTION');
});

// ---------- temp-effect lifecycle ----------

test('decayTempEffects: decrements remaining; expired effects are removed', () => {
  const seat = { tempEffects: [
    { id: 'a', effectId: 'doubleMaxLine', expiresInTurns: 1, payload: null },
    { id: 'b', effectId: 'tierBoost', expiresInTurns: 3, payload: null }
  ]};
  const expired = decayTempEffects(seat);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].effectId, 'doubleMaxLine');
  assert.equal(seat.tempEffects.length, 1);
  assert.equal(seat.tempEffects[0].effectId, 'tierBoost');
  assert.equal(seat.tempEffects[0].expiresInTurns, 2);
});

test('hasTempEffect detects active effect', () => {
  const seat = { tempEffects: [{ id: 'a', effectId: 'foo', expiresInTurns: 2 }] };
  assert.equal(hasTempEffect(seat, 'foo'), true);
  assert.equal(hasTempEffect(seat, 'bar'), false);
});

test('endTurn: decays temp effects on the new active seat', () => {
  let s = makeRoom(2);
  s.seats[1].tempEffects = [
    { id: 'a', effectId: 'doubleMaxLine', expiresInTurns: 1, payload: null }
  ];
  s.turn = { seat: 0, phase: 'endable', lastRoll: [3, 5], doublesCount: 0 };
  s = step(s, { type: 'endTurn', seat: 0 });
  assert.equal(s.seats[1].tempEffects.length, 0);
});
