// Reserve event-card catalog. Two decks (community + chance) ported from the
// reserve project. Each card carries one or more effects that the engine
// resolves immediately on draw. Cards that need user input (stock options,
// insider tip, special-loan accept/decline) will land in a later sub-phase;
// the v1 set here is fully auto-resolving.
//
// Effects are processed in `applyEventCard` (see engine/reserve/eventCards.js).
// The shape of a card's `effects` array is:
//   [{ kind: '<type>', ...payload }, ...]
//
// Supported effect kinds (v1):
//   'cash'              { amount }                   — credit/debit cash
//   'creditScoreDelta'  { amount }                   — adjust credit score
//   'dividend'          { symbol, pct }              — pay (shares×price×pct)
//   'flatDividend'      { amount, requireAnyShares } — flat payout
//   'shareGrant'        { symbol, qty }              — grant shares (basis 0)
//   'shareGrantAll'     { qty }                      — N shares of every volatile stock
//   'marketShock'       { pct }                      — pct change to all volatile stocks
//   'stockShock'        { symbol, pct }              — pct change to one symbol
//   'tempEffect'        { effectId, turns, payload } — push a tempEffect entry
//   'specialLoan'       { principal, term, ptr }     — instantly create a loan
//   'bankPaysInstallment'                            — bank pays next due installment

export const RESERVE_COMMUNITY_DECK = [
  {
    id: 'cmty.insurance',
    name: 'Insurance Payout',
    blurb: 'You receive an insurance settlement of $200.',
    effects: [{ kind: 'cash', amount: 200 }]
  },
  {
    id: 'cmty.cashBonus',
    name: 'Quarterly Bonus',
    blurb: 'Your end-of-quarter performance pays $100.',
    effects: [{ kind: 'cash', amount: 100 }]
  },
  {
    id: 'cmty.dividendMncl',
    name: 'MNCL Dividend',
    blurb: 'MNCL pays a 10% dividend on your holdings.',
    effects: [{ kind: 'dividend', symbol: 'MNCL', pct: 0.10 }]
  },
  {
    id: 'cmty.dividendFp500',
    name: 'F&P500 Dividend',
    blurb: 'The index distributes a $50 dividend if you own any shares.',
    effects: [{ kind: 'flatDividend', amount: 50, requireAnyShares: true }]
  },
  {
    id: 'cmty.inheritFp500',
    name: 'Inheritance — Diversified',
    blurb: 'You inherit one share of every volatile stock.',
    effects: [{ kind: 'shareGrantAll', qty: 1 }]
  },
  {
    id: 'cmty.inheritMncl',
    name: 'Inheritance — MNCL',
    blurb: 'You inherit five shares of MNCL.',
    effects: [{ kind: 'shareGrant', symbol: 'MNCL', qty: 5 }]
  },
  {
    id: 'cmty.creditBump15',
    name: 'Credit Reporting Adjustment',
    blurb: 'A reporting error is corrected. Credit score +15.',
    effects: [{ kind: 'creditScoreDelta', amount: 15 }]
  },
  {
    id: 'cmty.creditBump10',
    name: 'On-Time Payment Streak',
    blurb: 'Consistent payments boost your score by +10.',
    effects: [{ kind: 'creditScoreDelta', amount: 10 }]
  },
  {
    id: 'cmty.bankPaysInstallment',
    name: 'Goodwill Adjustment',
    blurb: 'The bank covers your next-due loan installment.',
    effects: [{ kind: 'bankPaysInstallment' }]
  },
  {
    id: 'cmty.tempZeroInterest',
    name: 'Promotional Rate',
    blurb: 'Next loan offered at 0% PTR (3 turns).',
    effects: [{ kind: 'tempEffect', effectId: 'zeroInterestNextLoan', turns: 3 }]
  }
];

export const RESERVE_CHANCE_DECK = [
  {
    id: 'chance.crash30',
    name: 'Market Correction (-30%)',
    blurb: 'Every volatile stock falls 30%.',
    effects: [{ kind: 'marketShock', pct: -30 }]
  },
  {
    id: 'chance.crash60',
    name: 'Market Crash (-60%)',
    blurb: 'A crash takes every volatile stock down 60%.',
    effects: [{ kind: 'marketShock', pct: -60 }]
  },
  {
    id: 'chance.surgeCane150',
    name: 'CANE Surge (+150%)',
    blurb: 'CANE explodes upward 150%.',
    effects: [{ kind: 'stockShock', symbol: 'CANE', pct: 150 }]
  },
  {
    id: 'chance.dropTpht75',
    name: 'TPHT Collapse (-75%)',
    blurb: 'TPHT loses 75% on a regulatory bombshell.',
    effects: [{ kind: 'stockShock', symbol: 'TPHT', pct: -75 }]
  },
  {
    id: 'chance.surgeTphtMncl50',
    name: 'TPHT + MNCL Rally',
    blurb: 'TPHT and MNCL each gain 50%.',
    effects: [
      { kind: 'stockShock', symbol: 'TPHT', pct: 50 },
      { kind: 'stockShock', symbol: 'MNCL', pct: 50 }
    ]
  },
  {
    id: 'chance.swingRrrdBorr',
    name: 'Sector Rotation',
    blurb: 'RRRD loses 50%; BORR jumps 75%.',
    effects: [
      { kind: 'stockShock', symbol: 'RRRD', pct: -50 },
      { kind: 'stockShock', symbol: 'BORR', pct: 75 }
    ]
  },
  {
    id: 'chance.tempDoubleMaxLoan',
    name: 'Pre-Approved Credit Line',
    blurb: 'Max loan line doubled for 3 turns.',
    effects: [{ kind: 'tempEffect', effectId: 'doubleMaxLine', turns: 3 }]
  },
  {
    id: 'chance.tempCreditSurge',
    name: 'Tier Bump (5 turns)',
    blurb: 'Treated as one tier higher for 5 turns.',
    effects: [{ kind: 'tempEffect', effectId: 'tierBoost', turns: 5, payload: { tiers: 1 } }]
  },
  {
    id: 'chance.specialLoan',
    name: 'Promotional Loan',
    blurb: 'Instant $1,000 loan, 5 turns, 5% per turn.',
    effects: [{ kind: 'specialLoan', principal: 1000, term: 5, ptr: 0.05 }]
  },
  {
    id: 'chance.halfCardFees',
    name: 'Promotional Fee Waiver',
    blurb: 'Card rotating fees halved for 5 turns.',
    effects: [{ kind: 'tempEffect', effectId: 'halfCardFees', turns: 5 }]
  }
];

export const RESERVE_DECKS = {
  community: RESERVE_COMMUNITY_DECK,
  chance: RESERVE_CHANCE_DECK
};

export function getEventCard(deckName, cardId) {
  return RESERVE_DECKS[deckName]?.find((c) => c.id === cardId) ?? null;
}
