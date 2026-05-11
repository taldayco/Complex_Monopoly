import test from 'node:test';
import assert from 'node:assert/strict';
import { transferToCreditor, returnToBank, liquidateBuildings, checkGameOver } from '../bankruptcy.js';
import { makeRoom, giveProperty } from './helpers.js';

test('transferToCreditor moves cash + unmortgaged properties; mortgaged ones forfeit to bank', () => {
  const room = makeRoom(2);
  room.seats[0].cash = 50;
  room.seats[1].cash = 100;
  giveProperty(room, 0, 1);
  giveProperty(room, 0, 3, { mortgaged: true });

  transferToCreditor(room, 0, 1);

  assert.equal(room.seats[0].bankrupt, true);
  assert.equal(room.seats[0].cash, 0);
  assert.equal(room.seats[1].cash, 150);
  assert.equal(room.properties[1].ownerSeat, 1);
  assert.equal(room.properties[3].ownerSeat, null);
  assert.equal(room.properties[3].mortgaged, false);
});

test('liquidateBuildings sells all houses to bank', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1, { houses: 3 }); // Mediterranean: 50 house cost, refund 25/house = 75
  giveProperty(room, 0, 3, { houses: 2 }); // Baltic: 50 house cost, refund 25/house = 50
  const beforeCash = room.seats[0].cash;
  const beforeHouses = room.bank.housesAvailable;

  const refund = liquidateBuildings(room, 0);

  assert.equal(refund, 75 + 50);
  assert.equal(room.seats[0].cash, beforeCash + 125);
  assert.equal(room.bank.housesAvailable, beforeHouses + 5);
  assert.equal(room.properties[1].houses, 0);
  assert.equal(room.properties[3].houses, 0);
});

test('returnToBank clears all properties and cash', () => {
  const room = makeRoom(2);
  giveProperty(room, 0, 1);
  giveProperty(room, 0, 5);
  room.seats[0].cash = 200;
  room.seats[0].getOutOfJailFreeChance = true;

  returnToBank(room, 0);

  assert.equal(room.seats[0].bankrupt, true);
  assert.equal(room.seats[0].cash, 0);
  assert.equal(room.properties[1].ownerSeat, null);
  assert.equal(room.properties[5].ownerSeat, null);
  assert.equal(room.seats[0].getOutOfJailFreeChance, false);
  assert.ok(room.chance.discard.includes('CH08'));
});

test('checkGameOver flags finished when only one solvent player remains', () => {
  const room = makeRoom(3);
  room.seats[0].bankrupt = true;
  room.seats[1].bankrupt = true;
  const over = checkGameOver(room);
  assert.equal(over, true);
  assert.equal(room.phase, 'finished');
  assert.equal(room.winnerSeat, 2);
});

test('checkGameOver returns false with multiple solvent players', () => {
  const room = makeRoom(3);
  const over = checkGameOver(room);
  assert.equal(over, false);
  assert.equal(room.phase, 'playing');
});

test('transferToCreditor wipes the debtor standard loans, credit-card balances, and pendings', () => {
  const room = makeRoom(2);
  const debtor = room.seats[0];
  debtor.cash = 0;
  debtor.loans = [
    { id: 'L-1', status: 'active', balance: 500, source: undefined, dueThisTurn: true },
    { id: 'M-1', status: 'active', balance: 300, source: 'mortgage' }
  ];
  debtor.creditCards = [
    { id: 'CC-1', cardId: 'goRewards', status: 'active', balance: 250 }
  ];
  room.pendingTransfers = [
    { id: 'TR-1', fromSeat: 0, toSeat: 1, amount: 50, status: 'pending' },
    { id: 'TR-2', fromSeat: 1, toSeat: 0, amount: 75, status: 'pending' }
  ];
  room.pendingAction = { type: 'settleDebt', debtorSeat: 0, amount: 100, creditor: { kind: 'player', seat: 1 } };

  transferToCreditor(room, 0, 1);

  assert.equal(debtor.bankrupt, true);
  // Standard loan closed, balance zero.
  assert.equal(debtor.loans[0].status, 'closed');
  assert.equal(debtor.loans[0].balance, 0);
  // Mortgage-source loan tagged forfeited (audit trail).
  assert.equal(debtor.loans[1].status, 'forfeited');
  assert.equal(debtor.loans[1].balance, 0);
  // Credit card cancelled with zero balance.
  assert.equal(debtor.creditCards[0].status, 'cancelled');
  assert.equal(debtor.creditCards[0].balance, 0);
  assert.equal(debtor.creditCards[0].cancelReason, 'bankruptcy');
  // Pending transfers + settleDebt for the bankrupt seat are cleared.
  assert.equal(room.pendingTransfers.length, 0);
  assert.equal(room.pendingAction, null);
  // Two-player game with one bankrupt → game-over fires automatically.
  assert.equal(room.phase, 'finished');
  assert.equal(room.winnerSeat, 1);
});
