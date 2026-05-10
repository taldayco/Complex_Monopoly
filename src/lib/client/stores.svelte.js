// Client-side reactive state using Svelte 5 runes.

export const conn = $state({
  status: 'idle', // 'idle' | 'connecting' | 'open' | 'closed'
  error: null
});

export const session = $state({
  roomCode: null,
  playerToken: null,
  seat: null
});

export const game = $state({
  state: null,        // the scrubbed game state from the server
  myError: null       // last error message specifically targeted at this client
});

export const ui = $state({
  selectedSpaceIndex: null,
  showTrade: false,
  tradeTarget: null,
  showProperties: false,
  showReserve: false,
  reserveTab: 'market', // 'market' | 'loans' | 'cards' | 'bank' | 'requests'
  showPropertiesModal: false,
  showMarketMonitor: false
});

export function openReserve(tab = 'market') {
  ui.reserveTab = tab;
  ui.showReserve = true;
}

export function setError(msg) {
  game.myError = msg;
  if (msg) {
    setTimeout(() => {
      if (game.myError === msg) game.myError = null;
    }, 4000);
  }
}
