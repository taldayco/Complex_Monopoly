<script>
  import { BOARD } from '$lib/shared/board.js';
  import { ui } from '$lib/client/stores.svelte.js';

  let { state, mySeat } = $props();

  function ownedBy(seatIdx) {
    const out = [];
    for (const [iStr, p] of Object.entries(state.properties)) {
      if (p.ownerSeat === seatIdx) out.push(Number(iStr));
    }
    return out.sort((a, b) => a - b);
  }

  function startTradeWith(seatIdx) {
    ui.tradeTarget = seatIdx;
    ui.showTrade = true;
  }
</script>

<div class="panel">
  {#each state.seats as s (s.seat)}
    <div
      class="card"
      class:current={s.seat === state.turn?.seat}
      class:bankrupt={s.bankrupt}
      class:disconnected={!s.connected}
    >
      <div class="header">
        <div class="piece" style:background={`var(--player-${s.seat})`}>
          {s.name.charAt(0).toUpperCase()}
        </div>
        <div class="name-block">
          <div class="name">
            {s.name}{s.seat === mySeat ? ' (you)' : ''}
            {#if s.seat === state.hostSeat}<span class="host-tag">★</span>{/if}
          </div>
          <div class="status">
            {#if s.bankrupt}Bankrupt
            {:else if !s.connected}Disconnected
            {:else if s.inJail}In Jail (turn {s.jailTurns}/3)
            {:else}On {BOARD[s.position].name}{/if}
          </div>
        </div>
      </div>
      <div class="cash">${s.cash.toLocaleString()}</div>

      <div class="properties">
        {#each ownedBy(s.seat) as i (i)}
          {@const space = BOARD[i]}
          <div
            class="prop"
            style:background={space.colorGroup ? `var(--${space.colorGroup})` : 'var(--rail)'}
            class:mortgaged={state.properties[i].mortgaged}
            title={space.name + (state.properties[i].mortgaged ? ' (mortgaged)' : '')}
            onclick={() => (ui.selectedSpaceIndex = i)}
            role="button"
            tabindex="0"
          >
            {#if state.properties[i].houses > 0 && state.properties[i].houses < 5}
              {state.properties[i].houses}h
            {:else if state.properties[i].houses === 5}
              H
            {/if}
          </div>
        {/each}
      </div>

      {#if s.getOutOfJailFreeChance || s.getOutOfJailFreeCommunity}
        <div class="cards-held">
          {s.getOutOfJailFreeChance ? '🎫 Chance get-out card ' : ''}
          {s.getOutOfJailFreeCommunity ? '🎫 Community get-out card' : ''}
        </div>
      {/if}

      {#if s.seat !== mySeat && !s.bankrupt && state.phase === 'playing'}
        <button class="trade-btn" onclick={() => startTradeWith(s.seat)}>
          Trade
        </button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .panel {
    padding: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .card {
    background: #fff;
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 0.6rem;
    transition: border-color 0.2s;
  }
  .card.current {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .card.bankrupt { opacity: 0.4; }
  .card.disconnected { background: #f5f5f5; }
  .header { display: flex; gap: 0.6rem; align-items: center; }
  .piece {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    color: #fff;
    font-weight: bold;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .name-block { flex: 1; min-width: 0; }
  .name {
    font-weight: 600;
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .host-tag { color: var(--warn); margin-left: 0.2rem; }
  .status { font-size: 0.7rem; color: var(--ink-mute); }
  .cash {
    font-size: 1.2rem;
    font-weight: bold;
    color: var(--accent);
    margin-top: 0.4rem;
  }
  .properties {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    margin-top: 0.4rem;
  }
  .prop {
    width: 16px;
    height: 16px;
    border: 1px solid #000;
    cursor: pointer;
    color: #fff;
    font-size: 0.5rem;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .prop.mortgaged { opacity: 0.4; }
  .cards-held { font-size: 0.7rem; color: var(--ink-mute); margin-top: 0.4rem; }
  .trade-btn {
    margin-top: 0.5rem;
    width: 100%;
    font-size: 0.8rem;
    padding: 0.3rem;
  }
</style>
