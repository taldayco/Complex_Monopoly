// Client → server actions
export const C2S = {
  AUTH: 'auth',
  CREATE_ROOM: 'createRoom',
  JOIN_ROOM: 'joinRoom',
  LEAVE_ROOM: 'leaveRoom',
  SET_READY: 'setReady',
  START_GAME: 'startGame',
  ROLL_FOR_ORDER: 'rollForOrder',
  ROLL_DICE: 'rollDice',
  BUY_PROPERTY: 'buyProperty',
  BUY_PROPERTY_WITH_MORTGAGE: 'buyPropertyWithMortgage',
  BUY_PROPERTY_WITH_CARD: 'buyPropertyWithCard',
  DECLINE_TO_BUY: 'declineToBuy',
  BID: 'bid',
  PASS_AUCTION: 'passAuction',
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

  // Reserve: loans
  REQUEST_LOAN: 'requestLoan',
  BANKER_ROLL_LOAN_RATE: 'bankerRollLoanRate',
  RESPOND_LOAN_OFFER: 'respondLoanOffer',
  PAY_LOAN_INSTALLMENT: 'payLoanInstallment',
  PAYOFF_LOAN: 'payoffLoan',
  SKIP_LOAN_INSTALLMENT: 'skipLoanInstallment',

  // Reserve: stocks
  BUY_STOCK: 'buyStock',
  BUY_STOCK_WITH_CARD: 'buyStockWithCard',
  SELL_STOCK: 'sellStock',

  // Reserve: credit cards
  REQUEST_CREDIT_CARD: 'requestCreditCard',
  REQUEST_CREDIT_LINE_INCREASE: 'requestCreditLineIncrease',
  BANKER_ASSIGN_CARD: 'bankerAssignCard',
  BANKER_REVOKE_CARD: 'bankerRevokeCard',
  CANCEL_CREDIT_CARD: 'cancelCreditCard',
  PAY_CARD_BALANCE: 'payCardBalance',

  // Reserve: event cards
  BANKER_SEND_EVENT_CARD: 'bankerSendEventCard',
  EVENT_CARD_ACTION: 'eventCardAction',
  DISMISS_EVENT_CARD: 'dismissEventCard',

  // Reserve: wire transfers
  WIRE_TRANSFER: 'wireTransfer',
  REQUEST_TRANSFER: 'requestTransfer',
  RESPOND_TRANSFER: 'respondTransfer',

  OPEN_BANK_ACCOUNT: 'openBankAccount',
  CLOSE_BANK_ACCOUNT: 'closeBankAccount',
  DEPOSIT_TO_BANK: 'depositToBank',
  WITHDRAW_FROM_BANK: 'withdrawFromBank',

  // Reserve: banker admin
  BANKER_ADJUST_CREDIT: 'bankerAdjustCredit',
  BANKER_WIRE: 'bankerWire',
  BANKER_APPROVE_REQUEST: 'bankerApproveRequest',
  BANKER_DENY_REQUEST: 'bankerDenyRequest',

  // Auction (server-injected timer tick is not a client message)
  AUCTION_TICK: 'auctionTick'
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
