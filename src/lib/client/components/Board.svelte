<script>
  import { BOARD } from '$lib/shared/board.js';
  import Space from './Space.svelte';
  import PlayerToken from './PlayerToken.svelte';
  import Dice from './Dice.svelte';
  import { ui } from '$lib/client/stores.svelte.js';

  let { state, mySeat } = $props();

  function gridPos(i) {
    if (i === 0) return { row: 11, col: 11, edge: 'corner' };
    if (i < 10) return { row: 11, col: 11 - i, edge: 'bottom' };
    if (i === 10) return { row: 11, col: 1, edge: 'corner' };
    if (i < 20) return { row: 21 - i, col: 1, edge: 'left' };
    if (i === 20) return { row: 1, col: 1, edge: 'corner' };
    if (i < 30) return { row: 1, col: i - 19, edge: 'top' };
    if (i === 30) return { row: 1, col: 11, edge: 'corner' };
    if (i < 40) return { row: i - 29, col: 11, edge: 'right' };
    return { row: 11, col: 11, edge: 'corner' };
  }

  // Group active tokens by position.
  const tokensByPosition = $derived.by(() => {
    const out = {};
    for (const s of state.seats) {
      if (s.bankrupt) continue;
      if (!out[s.position]) out[s.position] = [];
      out[s.position].push(s);
    }
    return out;
  });

  function selectSpace(i) {
    ui.selectedSpaceIndex = i;
  }
</script>

<div class="board">
  {#each BOARD as space (space.index)}
    {@const pos = gridPos(space.index)}
    <div
      class="cell"
      style:grid-row={pos.row}
      style:grid-column={pos.col}
      onclick={() => selectSpace(space.index)}
      role="button"
      tabindex="0"
      onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectSpace(space.index)}
    >
      <Space {space} {state} edge={pos.edge} />
      {#if tokensByPosition[space.index]}
        <div class="tokens">
          {#each tokensByPosition[space.index] as seat, idx (seat.seat)}
            <PlayerToken {seat} index={idx} mine={seat.seat === mySeat} />
          {/each}
        </div>
      {/if}
    </div>
  {/each}

  <div class="middle">
    <div class="title">MONOPOLY</div>
    <Dice {state} />
    <div class="cards">
      <div class="card-pile chance">Chance ({state.chance.deckSize})</div>
      <div class="card-pile cc">Community Chest ({state.communityChest.deckSize})</div>
    </div>
  </div>
</div>

<style>
  .board {
    --board-size: min(92vh, calc(100vw - 640px));
    width: var(--board-size);
    height: var(--board-size);
    display: grid;
    grid-template-rows: 1fr repeat(9, 1fr) 1fr;
    grid-template-columns: 1fr repeat(9, 1fr) 1fr;
    background: var(--board-bg);
    border: 2px solid var(--line);
    position: relative;
  }
  .cell {
    position: relative;
    border: 1px solid var(--line);
    cursor: pointer;
    overflow: hidden;
  }
  .tokens {
    position: absolute;
    inset: 0;
    pointer-events: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 2px;
  }
  .middle {
    grid-row: 2 / 11;
    grid-column: 2 / 11;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    background: var(--board-bg);
    pointer-events: none;
  }
  .middle .title {
    font-family: 'Georgia', serif;
    font-size: 3.5rem;
    font-weight: bold;
    color: var(--accent);
    letter-spacing: 0.1em;
    transform: rotate(-30deg);
  }
  .cards {
    display: flex;
    gap: 1rem;
    margin-top: 1rem;
  }
  .card-pile {
    padding: 0.6rem 1rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 4px;
    font-size: 0.85rem;
  }
  .card-pile.chance { background: #fde7c2; }
  .card-pile.cc { background: #c2dffd; }
</style>
