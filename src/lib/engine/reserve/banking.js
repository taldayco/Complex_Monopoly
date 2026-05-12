import { BANKS, BANK_IDS } from '../../shared/reserve/economyCatalog.js';
import { CARD_CATALOG, getHysaRateFor } from '../../shared/reserve/cardCatalog.js';
import { cents } from '../../shared/money.js';

const CARD_CATALOG_BANK_LABELS = {
  'MM Credit Union': 'mmcu',
  'Boardwalk National Bank': 'boardwalk'
};

export function bankIdForCardCatalogEntry(cardId) {
  const cat = CARD_CATALOG[cardId];
  return cat ? (CARD_CATALOG_BANK_LABELS[cat.bank] ?? null) : null;
}

export function openAccount(seat, bank, now = Date.now()) {
  if (!BANKS[bank]) return { ok: false, error: 'UNKNOWN_BANK' };
  ensureSeatBankAccounts(seat);
  const acct = seat.bankAccounts[bank];
  if (acct.open) return { ok: false, error: 'ALREADY_OPEN' };
  acct.open = true;
  acct.balance = 0;
  acct.openedAt = now;
  return { ok: true };
}

export function closeAccount(seat, bank) {
  if (!BANKS[bank]) return { ok: false, error: 'UNKNOWN_BANK' };
  ensureSeatBankAccounts(seat);
  const acct = seat.bankAccounts[bank];
  if (!acct.open) return { ok: false, error: 'NOT_OPEN' };
  if ((acct.balance ?? 0) > 0) return { ok: false, error: 'OUTSTANDING_BALANCE' };
  if (hasActiveLoanAtBank(seat, bank)) return { ok: false, error: 'ACTIVE_LOAN' };
  if (hasActiveCardAtBank(seat, bank)) return { ok: false, error: 'ACTIVE_CARD' };
  acct.open = false;
  acct.balance = 0;
  acct.openedAt = 0;
  return { ok: true };
}

export function deposit(seat, bank, amount) {
  if (!BANKS[bank]) return { ok: false, error: 'UNKNOWN_BANK' };
  if (typeof amount !== 'number' || !(amount > 0)) return { ok: false, error: 'BAD_AMOUNT' };
  ensureSeatBankAccounts(seat);
  const acct = seat.bankAccounts[bank];
  if (!acct.open) return { ok: false, error: 'NOT_OPEN' };
  if (seat.cash < amount) return { ok: false, error: 'INSUFFICIENT_FUNDS' };
  seat.cash = cents(seat.cash - amount);
  acct.balance = cents(acct.balance + amount);
  return { ok: true, amount: cents(amount), cash: seat.cash, balance: acct.balance };
}

export function withdraw(seat, bank, amount) {
  if (!BANKS[bank]) return { ok: false, error: 'UNKNOWN_BANK' };
  if (typeof amount !== 'number' || !(amount > 0)) return { ok: false, error: 'BAD_AMOUNT' };
  ensureSeatBankAccounts(seat);
  const acct = seat.bankAccounts[bank];
  if (!acct.open) return { ok: false, error: 'NOT_OPEN' };
  const cap = BANKS[bank].maxWithdrawal;
  if (amount > cap) return { ok: false, error: 'EXCEEDS_WITHDRAWAL_CAP', cap };
  if (acct.balance < amount) return { ok: false, error: 'INSUFFICIENT_BALANCE' };
  acct.balance = cents(acct.balance - amount);
  seat.cash = cents(seat.cash + amount);
  return { ok: true, amount: cents(amount), cash: seat.cash, balance: acct.balance };
}

export function applyHysaInterestAtTurnStart(seat, reserveRate) {
  ensureSeatBankAccounts(seat);
  const events = [];
  if (seat?.inJail) return events;
  const cardBonus = Math.max(0, getHysaRateFor(seat, 0));
  for (const id of BANK_IDS) {
    const acct = seat.bankAccounts[id];
    if (!acct.open) continue;
    const balance = acct.balance ?? 0;
    if (balance <= 0) continue;
    const baseRate = (reserveRate ?? 0) * BANKS[id].depositBeta + BANKS[id].hysaSpread;
    const rate = Math.max(0, baseRate + cardBonus);
    if (rate <= 0) continue;
    const interest = cents(balance * rate);
    if (interest <= 0) continue;
    acct.balance = cents(balance + interest);
    events.push({
      bank: id,
      bankName: BANKS[id].name,
      baseRate: Math.max(0, baseRate),
      cardBonus,
      rate,
      interest,
      balance: acct.balance
    });
  }
  return events;
}

export function eligibleForBoardwalkDiscount(seat) {
  if (hasActiveLoanAtBank(seat, 'mmcu')) return false;
  if (hasActiveCardAtBank(seat, 'mmcu')) return false;
  return true;
}

export function applyFdicDisaster(seats) {
  const losses = [];
  if (!Array.isArray(seats)) return { losses };
  for (const seat of seats) {
    if (!seat?.bankAccounts) continue;
    for (const id of BANK_IDS) {
      const acct = seat.bankAccounts[id];
      if (!acct?.open) continue;
      const balance = acct.balance ?? 0;
      const cap = BANKS[id].fdicCap;
      if (balance > cap) {
        const lost = cents(balance - cap);
        acct.balance = cap;
        losses.push({
          seat: seat.seat,
          bank: id,
          bankName: BANKS[id].name,
          balanceBefore: balance,
          balanceAfter: cap,
          lost
        });
      }
    }
  }
  return { losses };
}

export function ensureSeatBankAccounts(seat) {
  if (!seat.bankAccounts || typeof seat.bankAccounts !== 'object') {
    seat.bankAccounts = {};
  }
  for (const id of BANK_IDS) {
    if (!seat.bankAccounts[id] || typeof seat.bankAccounts[id] !== 'object') {
      seat.bankAccounts[id] = { open: false, balance: 0, openedAt: 0 };
    } else {
      const a = seat.bankAccounts[id];
      if (typeof a.open !== 'boolean') a.open = false;
      if (typeof a.balance !== 'number') a.balance = 0;
      if (typeof a.openedAt !== 'number') a.openedAt = 0;
    }
  }
}

function hasActiveLoanAtBank(seat, bank) {
  if (!Array.isArray(seat?.loans)) return false;
  return seat.loans.some((l) => l && l.status === 'active' && l.bank === bank);
}

function hasActiveCardAtBank(seat, bank) {
  if (!Array.isArray(seat?.creditCards)) return false;
  return seat.creditCards.some((c) => {
    if (!c || c.status !== 'active') return false;
    return bankIdForCardCatalogEntry(c.cardId) === bank;
  });
}
