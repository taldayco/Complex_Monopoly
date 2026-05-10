<script>
  import { session } from '$lib/client/stores.svelte.js';
  import Board from './Board.svelte';
  import PlayerPanel from './PlayerPanel.svelte';
  import ActionBar from './ActionBar.svelte';
  import GameLog from './GameLog.svelte';
  import AuctionModal from './AuctionModal.svelte';
  import TradeModal from './TradeModal.svelte';
  import JailModal from './JailModal.svelte';
  import JailSeizureModal from './JailSeizureModal.svelte';
  import TrainTravelModal from './TrainTravelModal.svelte';
  import CardChoiceModal from './CardChoiceModal.svelte';
  import BankruptcyModal from './BankruptcyModal.svelte';
  import CardModal from './CardModal.svelte';
  import PropertyCard from './PropertyCard.svelte';
  import ReserveHub from './reserve/ReserveHub.svelte';
  import MarketMonitor from './reserve/MarketMonitor.svelte';
  import PropertiesModal from './PropertiesModal.svelte';
  import { ui } from '$lib/client/stores.svelte.js';

  let { state: gs } = $props();

  const me = $derived(gs.seats.find((s) => s.seat === session.seat));
  const currentSeat = $derived(gs.seats[gs.turn.seat]);
  const isMyTurn = $derived(gs.turn.seat === session.seat);

  // Card-draw modal queue. Card landings can fire two draws back-to-back
  // (legacy chance/community + the reserve event card). Push each onto a
  // FIFO queue so the player sees them one at a time instead of one
  // overwriting the other.
  let cardQueue = $state([]);
  let lastSeenLogIndex = $state(-1);
  const recentCard = $derived(cardQueue[0] ?? null);

  $effect(() => {
    if (!gs.log) return;
    if (gs.log.length === 0) return;
    if (lastSeenLogIndex === -1) {
      lastSeenLogIndex = gs.log.length;
      return;
    }
    const newCards = [];
    for (let i = lastSeenLogIndex; i < gs.log.length; i++) {
      const e = gs.log[i];
      if (e.seat !== session.seat) continue;
      if (e.type === 'drawCard') {
        newCards.push(e.payload);
      } else if (e.type === 'eventCardDrawn') {
        newCards.push({
          kind: 'reserve',
          deck: e.payload.deck,
          cardId: e.payload.cardId,
          results: { effects: e.payload.effects ?? [] }
        });
      }
    }
    if (newCards.length > 0) cardQueue = [...cardQueue, ...newCards];
    lastSeenLogIndex = gs.log.length;
  });

  function dismissCard() {
    cardQueue = cardQueue.slice(1);
  }

  const auction = $derived(gs.pendingAction?.type === 'auction' ? gs.pendingAction : null);
  const settleDebt = $derived(gs.pendingAction?.type === 'settleDebt' && gs.pendingAction.debtorSeat === session.seat ? gs.pendingAction : null);
  const incomingTrade = $derived(gs.pendingTrade && gs.pendingTrade.toSeat === session.seat ? gs.pendingTrade : null);

  const trainTravel = $derived(
    gs.pendingTrainTravel && gs.pendingTrainTravel.seat === session.seat
      ? gs.pendingTrainTravel
      : null
  );
  const jailSeizure = $derived(
    gs.pendingJailSeizureChoice && gs.pendingJailSeizureChoice.seat === session.seat
      ? gs.pendingJailSeizureChoice
      : null
  );
  const cardChoice = $derived(
    gs.pendingCardChoice && gs.pendingCardChoice.seat === session.seat
      ? gs.pendingCardChoice
      : null
  );

  const inJailMyTurn = $derived(isMyTurn && me?.inJail && gs.turn.phase === 'preRoll');

  // Auto-open the Market Monitor for everyone whenever a Market Open window
  // is active. The user can also open it manually via the header button at
  // any other time.
  const marketOpenActive = $derived(!!gs.marketOpen?.active);
  const marketMonitorOpen = $derived(marketOpenActive || ui.showMarketMonitor);
  $effect(() => {
    if (marketOpenActive) ui.showMarketMonitor = true;
  });
</script>

<div class="game">
  <header>
    <div class="room-code">Room: <span class="code">{gs.code}</span></div>
    <button class="market-monitor-btn" onclick={() => (ui.showMarketMonitor = true)}>
      Market Monitor
    </button>
    <div class="turn-indicator">
      <span class="dot" style:background={`var(--player-${gs.turn.seat})`}></span>
      <strong>{currentSeat?.name ?? '—'}</strong>'s turn
      {#if gs.turn.lastRoll}
        · rolled {gs.turn.lastRoll[0]} + {gs.turn.lastRoll[1]} = {gs.turn.lastRoll[0] + gs.turn.lastRoll[1]}
      {/if}
    </div>
  </header>

  <div class="grid">
    <aside class="left">
      <PlayerPanel state={gs} mySeat={session.seat} />
    </aside>

    <main class="center">
      <Board state={gs} mySeat={session.seat} />
    </main>

    <aside class="right">
      <ActionBar state={gs} {me} {isMyTurn} />
      <GameLog log={gs.log} seats={gs.seats} />
    </aside>
  </div>

  {#if ui.selectedSpaceIndex != null}
    <PropertyCard
      spaceIndex={ui.selectedSpaceIndex}
      state={gs}
      onClose={() => (ui.selectedSpaceIndex = null)}
    />
  {/if}

  {#if auction}
    <AuctionModal state={gs} {auction} mySeat={session.seat} />
  {/if}

  {#if settleDebt}
    <BankruptcyModal state={gs} {settleDebt} mySeat={session.seat} />
  {/if}

  {#if incomingTrade}
    <TradeModal mode="respond" trade={incomingTrade} state={gs} mySeat={session.seat} />
  {:else if ui.showTrade}
    <TradeModal mode="propose" state={gs} mySeat={session.seat} target={ui.tradeTarget} />
  {/if}

  {#if inJailMyTurn}
    <JailModal state={gs} {me} />
  {/if}

  {#if trainTravel}
    <TrainTravelModal pending={trainTravel} />
  {/if}

  {#if jailSeizure}
    <JailSeizureModal pending={jailSeizure} state={gs} />
  {/if}

  {#if cardChoice}
    <CardChoiceModal pending={cardChoice} state={gs} {me} />
  {/if}

  {#if recentCard}
    <CardModal card={recentCard} onClose={dismissCard} />
  {/if}

  {#if ui.showReserve}
    <ReserveHub state={gs} mySeat={session.seat} />
  {/if}

  {#if marketMonitorOpen}
    <MarketMonitor state={gs} mySeat={session.seat} locked={marketOpenActive} />
  {/if}

  {#if ui.showPropertiesModal}
    <PropertiesModal state={gs} mySeat={session.seat} />
  {/if}
</div>

<style>
  .game {
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 1rem;
    padding: 0.6rem 1.2rem;
    background: var(--panel);
    border-bottom: 1px solid var(--panel-border);
  }
  .room-code { justify-self: start; }
  .room-code .code {
    font-family: monospace;
    background: var(--bg);
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
    letter-spacing: 0.1em;
  }
  .market-monitor-btn {
    justify-self: center;
    background: var(--accent);
    color: #fff;
    border: none;
    padding: 0.45rem 1rem;
    border-radius: 6px;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    letter-spacing: 0.02em;
  }
  .market-monitor-btn:hover { filter: brightness(1.1); }
  .turn-indicator { display: flex; align-items: center; gap: 0.6rem; justify-self: end; }
  .dot { width: 14px; height: 14px; border-radius: 50%; border: 1px solid #000; }
  .grid {
    flex: 1;
    display: grid;
    grid-template-columns: 280px 1fr 320px;
    gap: 0.8rem;
    padding: 0.8rem;
    overflow: hidden;
  }
  .left, .right {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    overflow-y: auto;
  }
  .right { display: flex; flex-direction: column; }
  .center {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
</style>
