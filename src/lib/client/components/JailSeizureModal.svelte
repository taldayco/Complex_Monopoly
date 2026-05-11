<script>
  import { actions } from '$lib/client/actions.js';
  import { BOARD } from '$lib/shared/board.js';

  let { pending, state } = $props();

  function forfeit(spaceIndex) {
    if (!confirm(`Forfeit ${BOARD[spaceIndex]?.name ?? 'this property'} to the bank?`)) return;
    actions.chooseJailSeizure({spaceIndex});
  }
</script>

<div class="overlay">
  <div class="modal">
    <h2>Forfeit a property</h2>
    <p>You were sent to jail. Pick one property to surrender to the bank.</p>
    <div class="props">
      {#each pending.choices as idx (idx)}
        {@const sp = BOARD[idx]}
        {@const p = state.properties?.[idx]}
        <button class="prop" onclick={() => forfeit(idx)}>
          <span
            class="dot"
            style:background={sp?.colorGroup ? `var(--${sp.colorGroup})` : 'var(--rail, #888)'}
          ></span>
          <span class="name">{sp?.name ?? `Space ${idx}`}</span>
          <span class="meta">
            {#if p?.houses === 5}Hotel{:else if p?.houses > 0}{p.houses}h{/if}
            {#if p?.mortgaged}M{/if}
            ${sp?.mortgageValue ?? 0}
          </span>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 220;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: var(--panel);
    border: 2px solid var(--danger);
    border-radius: 8px;
    padding: 1.3rem;
    width: 460px;
    max-width: 92vw;
    max-height: 80vh;
    overflow-y: auto;
  }
  h2 { color: var(--danger); margin: 0 0 0.4rem; }
  p { margin: 0 0 0.9rem; color: var(--ink-mute); }
  .props { display: flex; flex-direction: column; gap: 0.35rem; }
  .prop {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.5rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    color: inherit;
    cursor: pointer;
    font-size: 0.88rem;
    text-align: left;
  }
  .prop:hover { border-color: var(--danger); }
  .dot { width: 10px; height: 10px; border: 1px solid #000; flex-shrink: 0; }
  .name { flex: 1; font-weight: 600; }
  .meta { font-family: monospace; font-size: 0.78rem; color: var(--ink-mute); }
</style>
