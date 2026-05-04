<script>
  import { session } from '$lib/client/stores.svelte.js';
  import Board from './Board.svelte';
  import PlayerPanel from './PlayerPanel.svelte';
  import ActionBar from './ActionBar.svelte';
  import GameLog from './GameLog.svelte';
  import AuctionModal from './AuctionModal.svelte';
  import TradeModal from './TradeModal.svelte';
  import JailModal from './JailModal.svelte';
  import BankruptcyModal from './BankruptcyModal.svelte';
  import CardModal from './CardModal.svelte';
  import PropertyCard from './PropertyCard.svelte';
  import ReserveHub from './reserve/ReserveHub.svelte';
  import { ui } from '$lib/client/stores.svelte.js';

  let { state: gs } = $props();

  const me = $derived(gs.seats.find((s) => s.seat === session.seat));
  const currentSeat = $derived(gs.seats[gs.turn.seat]);
  const isMyTurn = $derived(gs.turn.seat === session.seat);

  // Most recent card draw event for the CardModal.
  let recentCard = $state(null);
  let lastSeenLogIndex = $state(-1);
  $effect(() => {
    if (!gs.log) return;
    if (gs.log.length === 0) return;
    if (lastSeenLogIndex === -1) {
      lastSeenLogIndex = gs.log.length;
      return;
    }
    for (let i = lastSeenLogIndex; i < gs.log.length; i++) {
      const e = gs.log[i];
      if (e.type === 'drawCard' && e.seat === session.seat) {
        recentCard = e.payload;
      }
    }
    lastSeenLogIndex = gs.log.length;
  });

  const auction = $derived(gs.pendingAction?.type === 'auction' ? gs.pendingAction : null);
  const settleDebt = $derived(gs.pendingAction?.type === 'settleDebt' && gs.pendingAction.debtorSeat === session.seat ? gs.pendingAction : null);
  const incomingTrade = $derived(gs.pendingTrade && gs.pendingTrade.toSeat === session.seat ? gs.pendingTrade : null);

  const inJailMyTurn = $derived(isMyTurn && me?.inJail && gs.turn.phase === 'preRoll');
</script>

<div class="game">
  <header>
    <div class="room-code">Room: <span class="code">{gs.code}</span></div>
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

  {#if recentCard}
    <CardModal card={recentCard} onClose={() => (recentCard = null)} />
  {/if}

  {#if ui.showReserve}
    <ReserveHub state={gs} mySeat={session.seat} />
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
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.6rem 1.2rem;
    background: var(--panel);
    border-bottom: 1px solid var(--panel-border);
  }
  .room-code .code {
    font-family: monospace;
    background: var(--bg);
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
    letter-spacing: 0.1em;
  }
  .turn-indicator { display: flex; align-items: center; gap: 0.6rem; }
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
