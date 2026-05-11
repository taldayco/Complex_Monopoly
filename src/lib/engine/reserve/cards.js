import {
  CARD_CATALOG,
  getCard,
  getCardBankCode,
  meetsTierRequirement,
  calcCreditLine,
  utilizationDelta,
  getMissedPaymentPenaltyForCard,
  CARD_PAYMENT_CYCLE_TURNS,
  CREDIT_LINE_INCREASE_PENALTY
} from '../../shared/reserve/cardCatalog.js';
import { clampCreditScore } from '../../shared/reserve/loanCatalog.js';
import { hasTempEffect } from './eventCards.js';
import { cents } from '../../shared/money.js';

import { newCreditCardId as genInstanceId } from '../../shared/ids.js';

export function applyForCard(seat, cardId, turnCount = 0, now = Date.now()) {
  const card = getCard(cardId);
  if (!card) return { error: 'UNKNOWN_CARD' };

  const newBank = getCardBankCode(cardId);
  if (newBank) {
    const sameBankActive = seat.creditCards.some((c) => {
      if (c.status !== 'active') return false;
      return getCardBankCode(c.cardId) === newBank;
    });
    if (sameBankActive) return { error: 'BANK_LIMIT_REACHED' };
  } else {
    const alreadyHas = seat.creditCards.some(
      (c) => c.cardId === cardId && c.status === 'active'
    );
    if (alreadyHas) return { error: 'ALREADY_OWNED' };
  }

  if (!meetsTierRequirement(seat, card.requiredTier)) {
    return { error: 'TIER_TOO_LOW' };
  }
  if (seat.cash < card.signingFee) return { error: 'INSUFFICIENT_FUNDS' };

  seat.cash = cents(seat.cash - card.signingFee + (card.signupBonus ?? 0));
  const creditLine = calcCreditLine(seat, cardId);
  const instance = {
    id: genInstanceId(seat, cardId),
    cardId,
    status: 'active',
    acquiredAt: now,
    openedAtTurn: turnCount,
    creditLine,
    autopay: true,
    balance: 0
  };
  seat.creditCards.push(instance);
  return { ok: true, card: instance, signingFee: card.signingFee, signupBonus: card.signupBonus ?? 0 };
}

export function requestCreditLineIncrease(seat, instanceId) {
  const inst = seat.creditCards.find((c) => c.id === instanceId && c.status === 'active');
  if (!inst) return { error: 'NO_CARD' };
  seat.creditScore = clampCreditScore((seat.creditScore ?? 720) - CREDIT_LINE_INCREASE_PENALTY);
  const newLine = calcCreditLine(seat, inst.cardId);
  const oldLine = inst.creditLine ?? 0;
  if (newLine > oldLine) {
    inst.creditLine = newLine;
    return { ok: true, newLine, oldLine, increased: true };
  }
  return { ok: true, newLine: oldLine, oldLine, increased: false };
}

export function cancelCard(seat, instanceId) {
  const idx = seat.creditCards.findIndex(
    (c) => c.id === instanceId && c.status === 'active'
  );
  if (idx === -1) return { error: 'NO_CARD' };
  const inst = seat.creditCards[idx];
  const card = getCard(inst.cardId);
  if (!card) return { error: 'UNKNOWN_CARD' };
  if ((inst.balance ?? 0) > 0) return { error: 'OUTSTANDING_BALANCE' };
  if (seat.cash < card.cancelFee) return { error: 'INSUFFICIENT_FUNDS' };
  seat.cash = cents(seat.cash - card.cancelFee);
  inst.status = 'cancelled';
  inst.cancelledAt = Date.now();
  return { ok: true, cancelFee: card.cancelFee };
}

export function applyTurnStartCardFees(seat) {
  const events = [];
  if (seat?.inJail) return events;
  const halfFees = hasTempEffect(seat, 'halfCardFees');
  for (const inst of seat.creditCards) {
    if (inst.status !== 'active') continue;
    const card = CARD_CATALOG[inst.cardId];
    if (!card) continue;
    const baseFee = card.rotatingFee ?? 0;
    if (baseFee <= 0) continue;
    const fee = halfFees ? Math.round(baseFee * 50) / 100 : baseFee;
    if (seat.cash >= fee) {
      seat.cash = cents(seat.cash - fee);
      events.push({ cardId: inst.cardId, fee, action: 'charged' });
    } else if ((inst.balance ?? 0) > 0) {
      inst.balance = cents((inst.balance ?? 0) + fee);
      const penalty = getMissedPaymentPenaltyForCard(inst.cardId);
      seat.creditScore = clampCreditScore((seat.creditScore ?? 720) - penalty);
      events.push({ cardId: inst.cardId, fee, action: 'addedToBalance', penalty, balance: inst.balance });
    } else {
      inst.status = 'cancelled';
      inst.cancelledAt = Date.now();
      inst.cancelReason = 'unpaidFee';
      events.push({ cardId: inst.cardId, fee, action: 'autoCancelled' });
    }
  }
  return events;
}

function effectiveCreditLine(inst, card) {
  return typeof inst.creditLine === 'number' ? inst.creditLine : (card.minLine ?? 0);
}

export function chargeCard(seat, instanceId, amount) {
  const inst = seat.creditCards.find((c) => c.id === instanceId && c.status === 'active');
  if (!inst) return { ok: false, error: 'NO_CARD' };
  const card = CARD_CATALOG[inst.cardId];
  if (!card) return { ok: false, error: 'UNKNOWN_CARD' };
  if (typeof amount !== 'number' || !(amount > 0)) return { ok: false, error: 'BAD_AMOUNT' };
  const limit = effectiveCreditLine(inst, card);
  const cur = inst.balance ?? 0;
  if (cur + amount > limit) {
    return { ok: false, error: 'INSUFFICIENT_CREDIT', limit, available: Math.max(0, limit - cur) };
  }
  inst.balance = cents(cur + amount);
  return { ok: true, charged: amount, balance: inst.balance, limit };
}

export function payCardBalance(seat, instanceId, amount) {
  const inst = seat.creditCards.find((c) => c.id === instanceId);
  if (!inst) return { ok: false, error: 'NO_CARD' };
  if (typeof amount !== 'number' || !(amount > 0)) return { ok: false, error: 'BAD_AMOUNT' };
  const cur = inst.balance ?? 0;
  if (cur <= 0) return { ok: false, error: 'NO_BALANCE' };
  const pay = Math.min(amount, cur);
  if (seat.cash < pay) return { ok: false, error: 'INSUFFICIENT_FUNDS' };
  seat.cash = cents(seat.cash - pay);
  inst.balance = cents(cur - pay);
  return { ok: true, paid: pay, balance: inst.balance };
}

function isCardCycleTurn(inst, turnCount) {
  if (typeof turnCount !== 'number' || turnCount <= 0) return false;
  const opened = typeof inst.openedAtTurn === 'number' ? inst.openedAtTurn : 0;
  if (turnCount <= opened) return false;
  return (turnCount - opened) % CARD_PAYMENT_CYCLE_TURNS === 0;
}

export function processCardCycle(seats, turnCount, reserveRate = 0) {
  const events = [];
  if (!Array.isArray(seats)) return events;
  if (typeof turnCount !== 'number' || turnCount <= 0) return events;
  const rateBase = typeof reserveRate === 'number' && Number.isFinite(reserveRate) ? reserveRate : 0;
  for (const seat of seats) {
    if (!Array.isArray(seat?.creditCards)) continue;
    if (seat.inJail) continue;
    for (const inst of seat.creditCards) {
      if (inst.status !== 'active') continue;
      const card = CARD_CATALOG[inst.cardId];
      if (!card) continue;
      if (!isCardCycleTurn(inst, turnCount)) continue;
      const balanceBefore = inst.balance ?? 0;
      if (balanceBefore <= 0) continue;
      const minPayment = card.minPayment ?? 0;
      const dueAmount = Math.min(minPayment, balanceBefore);
      const limit = effectiveCreditLine(inst, card);
      const utilization = limit > 0 ? balanceBefore / limit : 0;
      let paid = 0;
      let missed = false;
      if (inst.autopay !== false && seat.cash >= dueAmount) {
        seat.cash = cents(seat.cash - dueAmount);
        inst.balance = cents(balanceBefore - dueAmount);
        paid = dueAmount;
      } else {
        missed = true;
      }
      let creditDelta = 0;
      if (missed) {
        creditDelta = -getMissedPaymentPenaltyForCard(inst.cardId);
      } else {
        creditDelta = utilizationDelta(utilization);
      }
      if (creditDelta !== 0) {
        seat.creditScore = clampCreditScore((seat.creditScore ?? 720) + creditDelta);
      }
      const baseRate = card.interestRate ?? 0;
      const effectiveRate = Math.max(0, baseRate + rateBase);
      let interest = 0;
      if (effectiveRate > 0 && inst.balance > 0) {
        interest = cents(inst.balance * effectiveRate);
        if (interest > 0) {
          inst.balance = cents(inst.balance + interest);
        }
      }
      events.push({
        seatIndex: seat.seat,
        instanceId: inst.id,
        cardId: inst.cardId,
        balanceBefore,
        utilization,
        paid,
        missed,
        creditDelta,
        baseRate,
        reserveRate: rateBase,
        effectiveRate,
        interest,
        balance: inst.balance
      });
    }
  }
  return events;
}

export const accrueCardInterest = processCardCycle;
