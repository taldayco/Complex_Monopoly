<script>
  import { actions } from '$lib/client/actions.js';
  import { BOARD } from '$lib/shared/board.js';

  let { pending } = $props();

  const fromName = $derived(BOARD[pending.fromIdx]?.name ?? `Space ${pending.fromIdx}`);

  function travel(spaceIndex) {
    actions.chooseTrainDestination({spaceIndex});
  }
  function skip() {
    actions.skipTrainTravel();
  }
</script>

<div class="overlay">
  <div class="modal">
    <h2>Train Travel</h2>
    <p>You own connecting railroads. Travel from <strong>{fromName}</strong> to:</p>
    <div class="options">
      {#each pending.choices as idx (idx)}
        {@const passesGo = idx < pending.fromIdx}
        <button class="dest" onclick={() => travel(idx)}>
          <span class="rail-dot"></span>
          <span class="name">{BOARD[idx]?.name ?? `Space ${idx}`}</span>
          {#if passesGo}<span class="bonus">passes GO +$100</span>{/if}
        </button>
      {/each}
    </div>
    <button class="skip" onclick={skip}>Stay here</button>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 150;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: var(--panel);
    border: 2px solid var(--accent);
    border-radius: 8px;
    padding: 1.4rem;
    width: 420px;
    max-width: 92vw;
  }
  h2 { margin: 0 0 0.4rem; }
  p { margin: 0 0 1rem; color: var(--ink-mute); }
  .options { display: flex; flex-direction: column; gap: 0.4rem; }
  .dest {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    color: inherit;
    cursor: pointer;
    font-size: 0.9rem;
    text-align: left;
  }
  .dest:hover { border-color: var(--accent); }
  .rail-dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 1px solid #000;
    background: var(--rail, #888);
    flex-shrink: 0;
  }
  .name { flex: 1; font-weight: 600; }
  .bonus {
    font-size: 0.72rem;
    color: var(--good, #2e7d32);
    font-family: monospace;
  }
  .skip {
    margin-top: 0.8rem;
    width: 100%;
  }
</style>
