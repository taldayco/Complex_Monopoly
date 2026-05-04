<script>
  import { send } from '$lib/client/socket.js';
  import { BOARD, isOwnable } from '$lib/shared/board.js';
  import { COLOR_GROUPS } from '$lib/shared/constants.js';
  import { ui, openReserve } from '$lib/client/stores.svelte.js';

  let { state, me, isMyTurn } = $props();

  const turnPhase = $derived(state.turn?.phase);
  const pending = $derived(state.pendingAction);

  const myMonopolies = $derived.by(() => {
    if (!me) return [];
    const groups = [];
    for (const [g, indices] of Object.entries(COLOR_GROUPS)) {
      if (indices.every((i) => state.properties[i]?.ownerSeat === me.seat)) {
        groups.push(g);
      }
    }
    return groups;
  });

  function buy() { send({ type: 'buyProperty' }); }
  function decline() { send({ type: 'declineToBuy' }); }
  function roll() { send({ type: 'rollDice' }); }
  function endTurn() { send({ type: 'endTurn' }); }
  function rollForJail() { send({ type: 'rollForJail' }); }
  function payJailFine() { send({ type: 'payJailFine' }); }
  function useJailCard() { send({ type: 'useGetOutOfJail' }); }

  const canBuyDecision = $derived(
    pending?.type === 'buyDecision' && pending.seat === me?.seat
  );
  const canRoll = $derived(
    isMyTurn && turnPhase === 'preRoll' && !me?.inJail && !pending && me?.loanTurnResponded !== false
  );
  const loanBlocked = $derived(
    isMyTurn && turnPhase === 'preRoll' && me?.loanTurnResponded === false
  );
  const canEnd = $derived(
    isMyTurn && turnPhase === 'endable' && !pending
  );

  function openBuilds() {
    ui.showProperties = !ui.showProperties;
  }
</script>

<div class="action-bar">
  <div class="phase-label">
    {#if !isMyTurn}
      Waiting for {state.seats[state.turn.seat]?.name}…
    {:else if pending?.type === 'auction'}
      Auction in progress
    {:else if pending?.type === 'settleDebt' && pending.debtorSeat === me?.seat}
      You owe ${pending.amount}. Liquidate or declare bankruptcy.
    {:else if pending?.type === 'settleDebt'}
      Waiting for {state.seats[pending.debtorSeat]?.name} to settle…
    {:else if me?.inJail && turnPhase === 'preRoll'}
      You are in jail.
    {:else if loanBlocked}
      Loan installment due — open Loans to pay or skip.
    {:else if turnPhase === 'preRoll'}
      Your turn — roll the dice.
    {:else if turnPhase === 'endable'}
      Resolve actions and end turn.
    {/if}
  </div>

  {#if canBuyDecision}
    {@const space = BOARD[pending.spaceIndex]}
    <div class="buy-prompt">
      <strong>{space.name}</strong> — ${pending.price}
      <div class="row">
        <button class="primary" onclick={buy} disabled={me.cash < pending.price}>
          Buy ${pending.price}
        </button>
        <button onclick={decline}>Decline → Auction</button>
      </div>
    </div>
  {/if}

  <div class="row main-row">
    <button class="primary" onclick={roll} disabled={!canRoll}>Roll Dice</button>
    <button onclick={endTurn} disabled={!canEnd}>End Turn</button>
  </div>

  <div class="reserve-grid">
    <button onclick={() => openReserve('market')}>Market</button>
    <button onclick={() => openReserve('actions')}>Actions</button>
    <button onclick={() => openReserve('cards')}>Cards</button>
    <button onclick={() => openReserve('loans')}>Loans</button>
    <button onclick={() => openReserve('wire')}>Wire</button>
    <button onclick={() => openReserve('requests')}>Requests</button>
  </div>

  {#if me?.inJail && isMyTurn && turnPhase === 'preRoll'}
    <div class="jail-row">
      <button onclick={rollForJail}>Roll for Jail</button>
      <button onclick={payJailFine} disabled={me.cash < 50}>Pay $50</button>
      {#if me.getOutOfJailFreeChance || me.getOutOfJailFreeCommunity}
        <button onclick={useJailCard}>Use Card</button>
      {/if}
    </div>
  {/if}

  {#if myMonopolies.length > 0}
    <details class="builds">
      <summary>Build / Mortgage</summary>
      <div class="manage-grid">
        {#each Object.entries(state.properties) as [iStr, p] (iStr)}
          {#if p.ownerSeat === me?.seat}
            {@const i = Number(iStr)}
            {@const sp = BOARD[i]}
            <div class="prop-row">
              <span class="dot" style:background={sp.colorGroup ? `var(--${sp.colorGroup})` : 'var(--rail)'}></span>
              <span class="prop-name">{sp.name}</span>
              {#if sp.type === 'property'}
                <span class="houses-label">
                  {p.houses === 5 ? 'Hotel' : `${p.houses} houses`}
                </span>
                <button onclick={() => send({ type: 'buyHouse', spaceIndex: i })}>+</button>
                <button onclick={() => send({ type: 'sellHouse', spaceIndex: i })}>−</button>
              {/if}
              {#if !p.mortgaged}
                <button onclick={() => send({ type: 'mortgage', spaceIndex: i })}>Mortgage</button>
              {:else}
                <button onclick={() => send({ type: 'unmortgage', spaceIndex: i })}>Unmortgage</button>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    </details>
  {/if}
</div>

<style>
  .action-bar {
    padding: 0.8rem;
    border-bottom: 1px solid var(--panel-border);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    background: var(--panel);
  }
  .phase-label {
    font-size: 0.85rem;
    color: var(--ink-mute);
    font-style: italic;
  }
  .buy-prompt {
    background: #fffde7;
    border: 1px solid var(--warn);
    padding: 0.5rem;
    border-radius: 4px;
  }
  .row { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.4rem; }
  .main-row button { flex: 1; }
  .reserve-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.3rem;
    margin-top: 0.4rem;
  }
  .reserve-grid button { font-size: 0.78rem; padding: 0.35rem 0.4rem; }
  .jail-row { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .jail-row button { flex: 1; min-width: 0; }
  .builds {
    margin-top: 0.4rem;
    border-top: 1px dashed var(--panel-border);
    padding-top: 0.4rem;
  }
  .builds summary { cursor: pointer; font-weight: 600; font-size: 0.85rem; }
  .manage-grid {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    max-height: 240px;
    overflow-y: auto;
  }
  .prop-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.78rem;
  }
  .dot { width: 10px; height: 10px; border: 1px solid #000; flex-shrink: 0; }
  .prop-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .houses-label { color: var(--ink-mute); font-size: 0.7rem; }
  .prop-row button { padding: 0.15rem 0.35rem; font-size: 0.7rem; }
</style>
