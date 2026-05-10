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
//   'revealWildcards'   { symbol }                   — privately reveal that
//                                                       stock's wildcards to
//                                                       the drawing seat only

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
  },
  {
    id: 'cmty.lifeInsurance',
    name: 'Life Insurance Loophole',
    blurb: 'Doctors revive you. Claim your life insurance: receive $200.',
    effects: [{ kind: 'cash', amount: 200 }]
  },
  {
    id: 'cmty.maintenanceBill',
    name: 'Maintenance Bill',
    blurb: 'Pay $25 per house and $75 per hotel.',
    effects: [{ kind: 'maintenanceBill', perHouse: 25, perHotel: 75 }]
  },
  {
    id: 'cmty.taxAppealApproved',
    name: 'Property Tax Appeal Approved',
    blurb: 'Receive $25 for each developed property you own.',
    effects: [{ kind: 'taxAppeal', perDevelopedProperty: 25 }]
  },
  {
    id: 'cmty.contractorDiscount',
    name: 'Contractor Discount',
    blurb: 'Your next development costs 25% less.',
    effects: [{ kind: 'devModifier', amount: -0.25 }]
  },
  {
    id: 'cmty.contractorOverrun',
    name: 'Contractor Overrun',
    blurb: 'Your next development costs 25% more.',
    effects: [{ kind: 'devModifier', amount: 0.25 }]
  },
  {
    id: 'cmty.permitClerkLikesYou',
    name: 'Permit Clerk Likes You',
    blurb: 'Your next development permit fee is reduced by 50%.',
    effects: [{ kind: 'permitFeeModifier', amount: -0.5 }]
  },
  {
    id: 'cmty.cityGrant',
    name: 'City Grant',
    blurb: 'Build one house at 50% cost.',
    effects: [{ kind: 'devModifier', amount: -0.5, oneHouseOnly: true }]
  },
  {
    id: 'cmty.avoidJail',
    name: 'Avoid Jail',
    blurb: 'Keep until used. Avoid going to jail.',
    effects: [{ kind: 'grantInventory', item: 'avoidJail', qty: 1 }]
  },
  {
    id: 'cmty.wrongfullyAccused',
    name: 'Wrongfully Accused',
    blurb: 'If in jail, leave immediately and receive $200. Else keep until used.',
    effects: [{ kind: 'wrongfullyAccused' }]
  },
  {
    id: 'cmty.callOptionBORR',
    name: 'Call Option: BORR @ $30',
    blurb: 'Buy 1 share of BORR right now at $30.',
    effects: [{ kind: 'fixedTradeStock', symbol: 'BORR', qty: 1, price: 30, direction: 'buy' }]
  },
  {
    id: 'cmty.putOptionRRRD',
    name: 'Put Option: RRRD @ $50',
    blurb: 'Sell 1 share of RRRD right now at $50.',
    effects: [{ kind: 'fixedTradeStock', symbol: 'RRRD', qty: 1, price: 50, direction: 'sell' }]
  },
  {
    id: 'cmty.analystUpgrade',
    name: 'Analyst Upgrade',
    blurb: 'Choose any volatile stock. Its price rises 10%.',
    effects: [{ kind: 'cardChoice', choiceKind: 'stockUpgrade', amount: 0.10 }]
  },
  {
    id: 'cmty.analystDowngrade',
    name: 'Analyst Downgrade',
    blurb: 'Choose any volatile stock. Its price falls 10%.',
    effects: [{ kind: 'cardChoice', choiceKind: 'stockUpgrade', amount: -0.10 }]
  },
  {
    id: 'cmty.cousinBanker',
    name: 'Cousin at the Bank',
    blurb: 'Choose any active loan. Its rate drops 1% (floored at 0).',
    effects: [{ kind: 'cardChoice', choiceKind: 'rateDiscount', amount: -0.01 }]
  },
  {
    id: 'cmty.refinance',
    name: 'Refinance Offer',
    blurb: 'Choose any active loan. Reroll its rate using your current tier.',
    effects: [{ kind: 'cardChoice', choiceKind: 'refinance' }]
  },
  {
    id: 'cmty.insiderTip',
    name: 'Insider Tip',
    blurb: 'Choose any volatile stock. Privately reveal the next card on its deck.',
    effects: [{ kind: 'cardChoice', choiceKind: 'insiderTip' }]
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
  },
  {
    id: 'chance.insiderTipTPHT',
    name: 'Insider Tip — TPHT',
    blurb: 'A whisper from the trading floor reveals TPHT’s next two wildcards. Only you see it.',
    effects: [{ kind: 'revealWildcards', symbol: 'TPHT' }]
  },
  {
    id: 'chance.insiderTipMNCL',
    name: 'Insider Tip — MNCL',
    blurb: 'A whisper from the trading floor reveals MNCL’s next two wildcards. Only you see it.',
    effects: [{ kind: 'revealWildcards', symbol: 'MNCL' }]
  },
  {
    id: 'chance.insiderTipCANE',
    name: 'Insider Tip — CANE',
    blurb: 'A whisper from the trading floor reveals CANE’s next two wildcards. Only you see it.',
    effects: [{ kind: 'revealWildcards', symbol: 'CANE' }]
  },
  {
    id: 'chance.insiderTipRRRD',
    name: 'Insider Tip — RRRD',
    blurb: 'A whisper from the trading floor reveals RRRD’s next two wildcards. Only you see it.',
    effects: [{ kind: 'revealWildcards', symbol: 'RRRD' }]
  },
  {
    id: 'chance.insiderTipBORR',
    name: 'Insider Tip — BORR',
    blurb: 'A whisper from the trading floor reveals BORR’s next two wildcards. Only you see it.',
    effects: [{ kind: 'revealWildcards', symbol: 'BORR' }]
  },
  {
    id: 'chance.recoveryRally20',
    name: 'Recovery Rally',
    blurb: 'All stocks rise 20%.',
    effects: [{ kind: 'marketShock', pct: 20 }]
  },
  {
    id: 'chance.marketEuphoria',
    name: 'Market Euphoria',
    blurb: 'All stocks rise 40%. Inflation rises 0.3%.',
    effects: [
      { kind: 'marketShock', pct: 40 },
      { kind: 'inflationDelta', amount: 0.003 }
    ]
  },
  {
    id: 'chance.dividendSeason',
    name: 'Dividend Season',
    blurb: 'Each stock pays 5% per share owned.',
    effects: [{ kind: 'dividendAll', pct: 0.05 }]
  },
  {
    id: 'chance.shortSqueeze',
    name: 'Short Squeeze',
    blurb: 'The worst-performing stock immediately rises 100%.',
    effects: [{ kind: 'shortSqueeze', pct: 100 }]
  },
  {
    id: 'chance.cheapOilDrop75',
    name: 'Cheap Oil',
    blurb: 'RRRD and BORR both fall 75%.',
    effects: [
      { kind: 'stockShock', symbol: 'RRRD', pct: -75 },
      { kind: 'stockShock', symbol: 'BORR', pct: -75 }
    ]
  },
  {
    id: 'chance.carsExpensive50',
    name: 'Cars Are Too Expensive',
    blurb: 'RRRD and BORR rise 50%.',
    effects: [
      { kind: 'stockShock', symbol: 'RRRD', pct: 50 },
      { kind: 'stockShock', symbol: 'BORR', pct: 50 }
    ]
  },
  {
    id: 'chance.infrastructure30',
    name: 'Infrastructure Bill Passes',
    blurb: 'RRRD and BORR rise 30%.',
    effects: [
      { kind: 'stockShock', symbol: 'RRRD', pct: 30 },
      { kind: 'stockShock', symbol: 'BORR', pct: 30 }
    ]
  },
  {
    id: 'chance.consumerNostalgia75',
    name: 'Consumer Nostalgia Boom',
    blurb: 'MNCL rises 75%.',
    effects: [{ kind: 'stockShock', symbol: 'MNCL', pct: 75 }]
  },
  {
    id: 'chance.caneCrash150',
    name: 'CANE Insurance Removed',
    blurb: 'CANE crashes 150%.',
    effects: [{ kind: 'stockShock', symbol: 'CANE', pct: -150 }]
  },
  {
    id: 'chance.stimulus',
    name: 'Stimulus Checks',
    blurb: 'Every player receives $300. Inflation rises 0.5%.',
    effects: [
      { kind: 'cashAllSeats', amount: 300 },
      { kind: 'inflationDelta', amount: 0.005 }
    ]
  },
  {
    id: 'chance.classEnvy',
    name: 'Class Envy',
    blurb: 'The richest player pays $100 to the poorest player.',
    effects: [{ kind: 'classEnvy', amount: 100 }]
  },
  {
    id: 'chance.antitrust',
    name: 'Antitrust Investigation',
    blurb: 'Any player owning a full color group pays $200.',
    effects: [{ kind: 'antitrust', amount: 200 }]
  },
  {
    id: 'chance.boardwalkScandal',
    name: 'Boardwalk Scandal',
    blurb: 'Boardwalk customers lose $100 unless Excellent credit.',
    effects: [{ kind: 'boardwalkScandal', amount: 100 }]
  },
  {
    id: 'chance.lendingTighten',
    name: 'Lending Standards Tighten',
    blurb: 'Loan max sizes are reduced 50% until your next turn.',
    effects: [{ kind: 'tempEffect', effectId: 'maxLoanHalved', turns: 1 }]
  },
  {
    id: 'chance.creditCrunch',
    name: 'Credit Crunch',
    blurb: 'Until your next turn, Fair-credit players cannot apply for standard loans.',
    effects: [{ kind: 'tempEffect', effectId: 'fairCreditBlocked', turns: 1 }]
  },
  {
    id: 'chance.predatoryLawsuit',
    name: 'Predatory Lending Lawsuit',
    blurb: 'The player with the most active loans receives +20 credit and $200.',
    effects: [{ kind: 'predatoryLawsuit', creditDelta: 20, cashAmount: 200 }]
  },
  {
    id: 'chance.regionalBankFailure',
    name: 'Regional Bank Failure',
    blurb: 'Roll a die. Odd = MMCU affected. Even = Boardwalk. Balances above FDIC limits are lost.',
    effects: [{ kind: 'regionalBankFailure' }]
  },
  {
    id: 'chance.financialCrisis',
    name: 'Financial Crisis',
    blurb: 'Inflation resets to 1.0 and freezes for 10 turns. Interest rate freezes for 8 turns. All bank balances above FDIC ($5000) are wiped.',
    effects: [{ kind: 'financialCrisis', inflationFreezeTurns: 10, interestFreezeTurns: 8 }]
  }
];

export const RESERVE_DECKS = {
  community: RESERVE_COMMUNITY_DECK,
  chance: RESERVE_CHANCE_DECK
};

export function getEventCard(deckName, cardId) {
  return RESERVE_DECKS[deckName]?.find((c) => c.id === cardId) ?? null;
}
