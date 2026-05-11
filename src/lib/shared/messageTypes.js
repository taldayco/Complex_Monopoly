// Client → server actions. Authoritative list lives in
// `src/lib/client/actions.js#ACTION_TYPES` (consumed by the typed-actions
// wrapper) and the reducer's ACTION_REGISTRY map. This enum mirrors them for
// callers that want a named constant rather than a string literal.
export const C2S = {
  AUTH: 'auth',
  CREATE_ROOM: 'createRoom',
  JOIN_ROOM: 'joinRoom',
  LEAVE_ROOM: 'leaveRoom',
  START_GAME: 'startGame',
  ROLL_FOR_ORDER: 'rollForOrder',
  ROLL_DICE: 'rollDice',
  BUY_PROPERTY: 'buyProperty',
  BUY_PROPERTY_WITH_MORTGAGE: 'buyPropertyWithMortgage',
  BUY_PROPERTY_WITH_CARD: 'buyPropertyWithCard',
  DECLINE_TO_BUY: 'declineToBuy',
  BID: 'bid',
  REQUEST_MORTGAGE_LOAN: 'requestMortgageLoan',
  PAY_MORTGAGE_INSTALLMENT: 'payMortgageInstallment',
  SKIP_MORTGAGE_INSTALLMENT: 'skipMortgageInstallment',
  PAYOFF_MORTGAGE_LOAN: 'payoffMortgageLoan',
  SELL_PROPERTY_TO_BANK: 'sellPropertyToBank',
  BUY_HOUSE: 'buyHouse',
  SELL_HOUSE: 'sellHouse',
  PROPOSE_TRADE: 'proposeTrade',
  RESPOND_TRADE: 'respondTrade',
  CANCEL_TRADE: 'cancelTrade',
  USE_GET_OUT_OF_JAIL: 'useGetOutOfJail',
  PAY_JAIL_FINE: 'payJailFine',
  ROLL_FOR_JAIL: 'rollForJail',
  DECLARE_BANKRUPTCY: 'declareBankruptcy',
  END_TURN: 'endTurn',
  SKIP_PLAYER: 'skipPlayer',

  REQUEST_LOAN: 'requestLoan',
  RESPOND_LOAN_OFFER: 'respondLoanOffer',
  PAY_LOAN_INSTALLMENT: 'payLoanInstallment',
  PAYOFF_LOAN: 'payoffLoan',
  SKIP_LOAN_INSTALLMENT: 'skipLoanInstallment',

  BUY_STOCK: 'buyStock',
  BUY_STOCK_WITH_CARD: 'buyStockWithCard',
  SELL_STOCK: 'sellStock',

  REQUEST_CREDIT_CARD: 'requestCreditCard',
  REQUEST_CREDIT_LINE_INCREASE: 'requestCreditLineIncrease',
  CANCEL_CREDIT_CARD: 'cancelCreditCard',
  PAY_CARD_BALANCE: 'payCardBalance',

  WIRE_TRANSFER: 'wireTransfer',
  REQUEST_TRANSFER: 'requestTransfer',
  RESPOND_TRANSFER: 'respondTransfer',
  CANCEL_TRANSFER: 'cancelTransfer',

  OPEN_BANK_ACCOUNT: 'openBankAccount',
  CLOSE_BANK_ACCOUNT: 'closeBankAccount',
  DEPOSIT_TO_BANK: 'depositToBank',
  WITHDRAW_FROM_BANK: 'withdrawFromBank'
};

// Server → client events
export const S2C = {
  WELCOME: 'welcome',
  STATE: 'state',
  ERROR: 'error',
  DISCONNECTED: 'disconnected',
  RECONNECTED: 'reconnected',
  PING: 'ping'
};
