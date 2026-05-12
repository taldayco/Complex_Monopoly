export const BASE_INFLATION_DECK = [
  { inf: 0.000 },
  { inf: 0.000 },
  { inf: 0.000 },
  { inf: 0.001 },
  { inf: 0.001 },
  { inf: 0.001 },
  { inf: 0.001 },
  { inf: 0.001 },
  { inf: 0.001 },
  { inf: 0.002 },
  { inf: 0.002 },
  { inf: 0.002 },
  { inf: 0.002 },
  { inf: 0.002 },
  { inf: 0.002 },
  { inf: 0.002 },
  { inf: 0.002 },
  { inf: 0.002 },
  { inf: 0.002 },
  { inf: 0.002 },
  { inf: 0.002 },
  { inf: 0.002 },
  { inf: 0.002 },
  { inf: 0.003 },
  { inf: 0.003 },
  { inf: 0.003 },
  { inf: 0.003 },
  { inf: 0.003 },
  { inf: 0.003 },
  { inf: 0.004 },
  { inf: 0.004 },
  { inf: 0.004 }
];

export const INFLATION_WILDCARD_POOL = [
  { inf: 0.01 },
  { inf: 0.01 },
  { inf: 0.01 },
  { inf: -0.005 },
  { inf: -0.005 },
  { inf: -0.005 }
];

export const STARTING_RESERVE_RATE = 0.03;
export const RESERVE_FLOOR = 0;
export const STARTING_INFLATION = 1.0;
export const ECONOMY_HISTORY_CAP = 100;
export const TARGET_INFLATION_PER_TURN = 0.002;
export const POLICY_REACTION = 0.5;
export const POLICY_LAG_TURNS = 3;

export const BANKS = {
  mmcu: {
    id: 'mmcu',
    name: 'MM Credit Union',
    maxWithdrawal: 2500,
    depositBeta: 0.4,
    hysaSpread: 0,
    fdicCap: 5000
  },
  boardwalk: {
    id: 'boardwalk',
    name: 'Boardwalk National Bank',
    maxWithdrawal: 10000,
    depositBeta: 0.6,
    hysaSpread: 0,
    fdicCap: 5000,
    minLoanTier: 'Very Good',
    loanDiscountIfMmFree: 0.015
  }
};

export const BANK_IDS = Object.keys(BANKS);
