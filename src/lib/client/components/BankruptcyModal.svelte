<script>
  import { send } from '$lib/client/socket.js';
  import { BOARD } from '$lib/shared/board.js';
  import { ui } from '$lib/client/stores.svelte.js';

  let { state, settleDebt, mySeat } = $props();

  const me = $derived(state.seats[mySeat]);
  const myProps = $derived(
    Object.entries(state.properties)
      .filter(([, p]) => p.ownerSeat === mySeat)
      .map(([i]) => Number(i))
  );

  function declare() {
    if (confirm('Declare bankruptcy? This cannot be undone.')) {
      send({ type: 'declareBankruptcy' });
    }
  }
</script>

<div class="overlay">
  <div class="modal">
    <h2>You owe ${settleDebt.amount}</h2>
    <p>You have ${me.cash}. Liquidate or declare bankruptcy.</p>

    <h4>Your properties</h4>
    <div class="props">
      {#each myProps as i (i)}
        {@const sp = BOARD[i]}
        {@const p = state.properties[i]}
        <div class="prop-row">
          <span class="dot" style:background={sp.colorGroup ? `var(--${sp.colorGroup})` : 'var(--rail)'}></span>
          <span class="name">{sp.name}</span>
          {#if sp.type === 'property' && p.houses > 0}
            <button onclick={() => send({ type: 'sellHouse', spaceIndex: i })}>
              Sell house (${Math.floor((sp.houseCost ?? 0) / 2)})
            </button>
          {/if}
          {#if !p.mortgaged && p.houses === 0}
            <button onclick={() => send({ type: 'sellPropertyToBank', spaceIndex: i })}>
              Sell to Bank (${sp.mortgageValue})
            </button>
          {/if}
        </div>
      {/each}
    </div>

    <div class="actions">
      <button class="danger" onclick={declare}>Declare Bankruptcy</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    z-index: 220;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: var(--panel);
    border: 2px solid var(--danger);
    border-radius: 8px;
    padding: 1.2rem;
    width: 500px;
    max-width: 90vw;
    max-height: 80vh;
    overflow-y: auto;
  }
  h2 { color: var(--danger); margin-top: 0; }
  .props {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin: 0.5rem 0 1rem;
    max-height: 300px;
    overflow-y: auto;
  }
  .prop-row { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; }
  .dot { width: 10px; height: 10px; border: 1px solid #000; flex-shrink: 0; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; justify-content: flex-end; }
</style>
