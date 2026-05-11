<script>
  import { actions } from '$lib/client/actions.js';
  import { fmtCash as fmt } from '$lib/client/format.js';
  import { BOARD } from '$lib/shared/board.js';
  import { ui, openReserve } from '$lib/client/stores.svelte.js';
  import { getTierByScore, sumOpenBankBalances } from '$lib/shared/reserve/loanCatalog.js';

  let { state, settleDebt, mySeat } = $props();

  const me = $derived(state.seats[mySeat]);
  const shortfall = $derived(Math.max(0, settleDebt.amount - (me?.cash ?? 0)));

  const myProps = $derived(
    Object.entries(state.properties)
      .filter(([, p]) => p.ownerSeat === mySeat)
      .map(([i]) => Number(i))
  );

  // Each rescue path is "available" only if it can actually generate cash for
  // the player right now. Greyed-out buttons are still rendered so the player
  // knows the option exists but isn't applicable (e.g. no bank account open).
  const stockValue = $derived.by(() => {
    if (!me) return 0;
    const market = state.stocks?.market ?? {};
    let total = 0;
    for (const sym of Object.keys(me.stockLots ?? {})) {
      const qty = me.stockLots[sym] ?? 0;
      total += qty * (market[sym]?.price ?? 0);
    }
    return total;
  });
  const canSellStocks = $derived(stockValue > 0);

  const canSellProperty = $derived(myProps.length > 0);

  const loanEligible = $derived.by(() => {
    if (!me || me.bankrupt) return false;
    const tier = getTierByScore(me.creditScore ?? 0).name;
    return tier !== 'Poor' && tier !== 'Very Poor';
  });

  const savingsBalance = $derived(sumOpenBankBalances(me));
  const canMoveFromSavings = $derived(savingsBalance > 0);

  function declare() {
    if (confirm('Declare bankruptcy? This cannot be undone.')) {
      actions.declareBankruptcy();
    }
  }
</script>

<div class="overlay">
  <div class="modal">
    <h2>You owe ${fmt(settleDebt.amount)}</h2>
    <p class="status">
      Cash on hand: <strong>${fmt(me?.cash ?? 0)}</strong>
      {#if shortfall > 0}
        · short <strong class="short">${fmt(shortfall)}</strong>
      {/if}
    </p>

    <p class="hint">Raise cash to settle, or declare bankruptcy as a last resort.</p>

    <div class="rescue-grid">
      <button
        class="rescue"
        onclick={() => (ui.showMarketMonitor = true)}
        disabled={!canSellStocks}
        title={canSellStocks ? `Portfolio: $${fmt(stockValue)}` : 'No stock holdings'}
      >
        <div class="rescue-title">Manage stocks</div>
        <div class="rescue-meta">
          {#if canSellStocks}Portfolio ~${fmt(stockValue)}{:else}No holdings{/if}
        </div>
      </button>

      <button
        class="rescue"
        onclick={() => (ui.showPropertiesModal = true)}
        disabled={!canSellProperty}
        title={canSellProperty ? 'Mortgage or sell properties' : 'You own no properties'}
      >
        <div class="rescue-title">Manage properties</div>
        <div class="rescue-meta">
          {#if canSellProperty}{myProps.length} owned{:else}None owned{/if}
        </div>
      </button>

      <button
        class="rescue"
        onclick={() => openReserve('loans')}
        disabled={!loanEligible}
        title={loanEligible ? 'Take out a standard loan' : 'Credit tier too low'}
      >
        <div class="rescue-title">Take out a loan</div>
        <div class="rescue-meta">
          {#if loanEligible}Tier {getTierByScore(me?.creditScore ?? 0).name}{:else}Credit tier ineligible{/if}
        </div>
      </button>

      <button
        class="rescue"
        onclick={() => openReserve('bank')}
        disabled={!canMoveFromSavings}
        title={canMoveFromSavings ? 'Withdraw from your savings account' : 'No funds in savings'}
      >
        <div class="rescue-title">Move from savings</div>
        <div class="rescue-meta">
          {#if canMoveFromSavings}${fmt(savingsBalance)} in savings{:else}No savings balance{/if}
        </div>
      </button>
    </div>

    {#if myProps.length > 0}
      <h4>Quick liquidate</h4>
      <div class="props">
        {#each myProps as i (i)}
          {@const sp = BOARD[i]}
          {@const p = state.properties[i]}
          <div class="prop-row">
            <span class="dot" style:background={sp.colorGroup ? `var(--${sp.colorGroup})` : 'var(--rail)'}></span>
            <span class="name">{sp.name}</span>
            {#if sp.type === 'property' && p.houses > 0}
              <button onclick={() => actions.sellHouse({spaceIndex: i})}>
                Sell house (${Math.floor((sp.houseCost ?? 0) / 2)})
              </button>
            {/if}
            {#if !p.mortgaged && p.houses === 0}
              <button onclick={() => actions.sellPropertyToBank({spaceIndex: i})}>
                Sell to Bank (${sp.mortgageValue})
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

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
    width: 540px;
    max-width: 92vw;
    max-height: 86vh;
    overflow-y: auto;
  }
  h2 { color: var(--danger); margin-top: 0; margin-bottom: 0.3rem; }
  .status { margin: 0 0 0.4rem; font-size: 0.9rem; }
  .short { color: var(--danger); }
  .hint { color: var(--ink-mute); font-size: 0.8rem; margin: 0 0 0.8rem; }

  .rescue-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
    margin-bottom: 0.8rem;
  }
  .rescue {
    text-align: left;
    padding: 0.5rem 0.6rem;
    background: var(--bg);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    color: inherit;
    cursor: pointer;
  }
  .rescue:hover:not([disabled]) {
    border-color: var(--accent);
  }
  .rescue[disabled] {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .rescue-title { font-weight: 600; font-size: 0.88rem; }
  .rescue-meta { font-size: 0.75rem; color: var(--ink-mute); margin-top: 0.15rem; }

  h4 { margin: 0.4rem 0 0.3rem; font-size: 0.8rem; color: var(--ink-mute); text-transform: uppercase; letter-spacing: 0.06em; }
  .props {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin: 0 0 1rem;
    max-height: 240px;
    overflow-y: auto;
  }
  .prop-row { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; }
  .dot { width: 10px; height: 10px; border: 1px solid #000; flex-shrink: 0; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; justify-content: flex-end; }
</style>
