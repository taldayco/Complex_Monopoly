export const BASE_INF_INT_DECK = [
  { inf: 0.000, int: -0.005 },
  { inf: 0.000, int: -0.005 },
  { inf: 0.000, int: -0.005 },
  { inf: 0.001, int: -0.0025 },
  { inf: 0.001, int: -0.0025 },
  { inf: 0.001, int: -0.0025 },
  { inf: 0.001, int: -0.0025 },
  { inf: 0.001, int: -0.0025 },
  { inf: 0.001, int: -0.0025 },
  { inf: 0.002, int: 0 },
  { inf: 0.002, int: 0 },
  { inf: 0.002, int: 0 },
  { inf: 0.002, int: 0 },
  { inf: 0.002, int: 0 },
  { inf: 0.002, int: 0 },
  { inf: 0.002, int: 0 },
  { inf: 0.002, int: 0 },
  { inf: 0.002, int: 0 },
  { inf: 0.002, int: 0 },
  { inf: 0.002, int: 0 },
  { inf: 0.002, int: 0 },
  { inf: 0.002, int: 0 },
  { inf: 0.002, int: 0 },
  { inf: 0.003, int: 0.0025 },
  { inf: 0.003, int: 0.0025 },
  { inf: 0.003, int: 0.0025 },
  { inf: 0.003, int: 0.0025 },
  { inf: 0.003, int: 0.0025 },
  { inf: 0.003, int: 0.0025 },
  { inf: 0.004, int: 0.005 },
  { inf: 0.004, int: 0.005 },
  { inf: 0.004, int: 0.005 }
];

export const INF_INT_WILDCARD_POOL = [
  { inf: 0.01,  int: 0.01 },
  { inf: 0.01,  int: 0.01 },
  { inf: 0.01,  int: 0.01 },
  { inf: -0.005, int: -0.01 },
  { inf: -0.005, int: -0.01 },
  { inf: -0.005, int: -0.01 }
];

export const STARTING_RESERVE_RATE = 0.03;
export const RESERVE_FLOOR = 0;
export const STARTING_INFLATION = 1.0;
export const ECONOMY_HISTORY_CAP = 100;

export const BANKS = {
  mmcu: {
    id: 'mmcu',
    name: 'MM Credit Union',
    maxWithdrawal: 2500,
    hysaSpread: -0.01,
    fdicCap: 5000
  },
  boardwalk: {
    id: 'boardwalk',
    name: 'Boardwalk National Bank',
    maxWithdrawal: 10000,
    hysaSpread: -0.0025,
    fdicCap: 5000,
    minLoanTier: 'Very Good',
    loanDiscountIfMmFree: 0.015
  }
};

export const BANK_IDS = Object.keys(BANKS);
