<script>
  import { actions } from '$lib/client/actions.js';
  import { BOARD, isOwnable } from '$lib/shared/board.js';
  import { COLOR_GROUPS, BUY_MORTGAGE_PTR, BUY_MORTGAGE_TERMS } from '$lib/shared/constants.js';
  import { getTierByScore } from '$lib/shared/reserve/loanCatalog.js';
  import { CARD_CATALOG } from '$lib/shared/reserve/cardCatalog.js';
  import { ui, openReserve } from '$lib/client/stores.svelte.js';
  import { cents } from '$lib/shared/money.js';

  // Alias the `state` prop to `gs` locally — having a variable literally
  // named `state` in scope makes the Svelte 5 compiler treat the `$state`
  // rune in this same file as auto-subscribing to that prop, producing
  // `n.subscribe is not a function` at mount.
  let { state: gs, me, isMyTurn } = $props();

  const turnPhase = $derived(gs.turn?.phase);
  const pending = $derived(gs.pendingAction);

  const myMonopolies = $derived.by(() => {
    if (!me) return [];
    const groups = [];
    for (const [g, indices] of Object.entries(COLOR_GROUPS)) {
      if (indices.every((i) => gs.properties[i]?.ownerSeat === me.seat)) {
        groups.push(g);
      }
    }
    return groups;
  });

  function buy() { actions.buyProperty(); }
  function decline() { actions.declineToBuy(); }
  function roll() { actions.rollDice(); }
  function endTurn() { actions.endTurn(); }
  function rollForJail() { actions.rollForJail(); }
  function payJailFine() { actions.payJailFine(); }
  function useJailCard() { actions.useGetOutOfJail(); }

  let mortgageTerm = $state(BUY_MORTGAGE_TERMS[0]);
  function buyWithMortgage() {
    actions.buyPropertyWithMortgage({term: mortgageTerm,
      spaceIndex: pending?.spaceIndex});
  }
  const mortgageEligible = $derived(
    me ? getTierByScore(me.creditScore ?? 0).name !== 'Poor' : false
  );
  const mortgageQuote = $derived.by(() => {
    if (!pending || pending.type !== 'buyDecision') return null;
    const principal = pending.price;
    const term = mortgageTerm;
    const totalDebt = cents(principal * (1 + BUY_MORTGAGE_PTR * term));
    const installment = cents(totalDebt / term);
    return { principal, term, totalDebt, installment };
  });

  // Active credit cards with enough headroom to charge the listed price.
  const cardOptions = $derived.by(() => {
    if (!me || !Array.isArray(me.creditCards)) return [];
    return me.creditCards
      .filter((c) => c.status === 'active')
      .map((c) => {
        const cat = CARD_CATALOG[c.cardId];
        const limit = cat?.minLine ?? 0;
        const balance = c.balance ?? 0;
        const available = Math.max(0, limit - balance);
        const fits = pending?.type === 'buyDecision' ? pending.price <= available : false;
        return { inst: c, cat, limit, balance, available, fits };
      });
  });
  function buyWithCard(instanceId) {
    actions.buyPropertyWithCard({instanceId,
      spaceIndex: pending?.spaceIndex});
  }

  const canBuyDecision = $derived(
    pending?.type === 'buyDecision' && pending.seat === me?.seat
  );
  const canRoll = $derived(
    isMyTurn && turnPhase === 'preRoll' && !me?.inJail && !pending &&
    me?.loanTurnResponded !== false && me?.mortgageTurnResponded !== false
  );
  const loanBlocked = $derived(
    isMyTurn && turnPhase === 'preRoll' && me?.loanTurnResponded === false
  );
  const mortgageBlocked = $derived(
    isMyTurn && turnPhase === 'preRoll' && me?.mortgageTurnResponded === false
  );
  const canEnd = $derived(
    isMyTurn && turnPhase === 'endable' && !pending
  );

</script>

<div class="action-bar">
  <div class="phase-label">
    {#if !isMyTurn}
      Waiting for {gs.seats[gs.turn.seat]?.name}…
    {:else if pending?.type === 'auction'}
      Auction in progress
    {:else if pending?.type === 'settleDebt' && pending.debtorSeat === me?.seat}
      You owe ${pending.amount}. Liquidate or declare bankruptcy.
    {:else if pending?.type === 'settleDebt'}
      Waiting for {gs.seats[pending.debtorSeat]?.name} to settle…
    {:else if me?.inJail && turnPhase === 'preRoll'}
      You are in jail.
    {:else if loanBlocked}
      Loan installment due — open Loans to pay or skip.
    {:else if mortgageBlocked}
      Mortgage installment due — open Loans to pay or skip.
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
      <div class="mortgage-section">
        <div class="mortgage-label">Buy with Mortgage @ 10%/turn</div>
        <div class="term-pills">
          {#each BUY_MORTGAGE_TERMS as t (t)}
            <button
              class="term-pill"
              class:active={mortgageTerm === t}
              onclick={() => (mortgageTerm = t)}
              disabled={!mortgageEligible}
            >{t} turns</button>
          {/each}
        </div>
        {#if mortgageQuote}
          <div class="quote">
            ${mortgageQuote.installment}/turn × {mortgageQuote.term}
            (total ${mortgageQuote.totalDebt})
          </div>
        {/if}
        {#if cardOptions.length > 0}
          <div class="mortgage-section card-section">
            <div class="mortgage-label">Buy with Credit Card</div>
            {#each cardOptions as opt (opt.inst.id)}
              <button
                class="card-row"
                onclick={() => buyWithCard(opt.inst.id)}
                disabled={!opt.fits}
                title={opt.fits ? '' : `Need $${pending.price} of credit; only $${opt.available} available`}
              >
                <span class="card-name">{opt.cat?.name ?? opt.inst.cardId}</span>
                <span class="card-meta">${opt.balance} / ${opt.limit} · {Math.round((opt.cat?.interestRate ?? 0) * 100)}%/4t</span>
              </button>
            {/each}
          </div>
        {/if}
        <button
          class="primary"
          onclick={buyWithMortgage}
          disabled={!mortgageEligible}
          title={mortgageEligible ? '' : 'Credit tier too low (Poor) — needs 580+'}
        >
          Mortgage {mortgageQuote ? `($${mortgageQuote.installment}/turn × ${mortgageQuote.term})` : ''}
        </button>
      </div>
    </div>
  {/if}

  <div class="row main-row">
    <button class="primary" onclick={roll} disabled={!canRoll}>Roll Dice</button>
    <button onclick={endTurn} disabled={!canEnd}>End Turn</button>
  </div>

  <div class="reserve-grid">
    <button onclick={() => openReserve('market')}>Market</button>
    <button onclick={() => (ui.showPropertiesModal = true)}>Properties</button>
    <button onclick={() => openReserve('cards')}>Cards</button>
    <button onclick={() => openReserve('loans')}>Loans</button>
    <button onclick={() => openReserve('bank')}>Bank</button>
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
      <summary>Build houses</summary>
      <div class="manage-grid">
        {#each Object.entries(gs.properties) as [iStr, p] (iStr)}
          {#if p.ownerSeat === me?.seat && BOARD[Number(iStr)]?.type === 'property'}
            {@const i = Number(iStr)}
            {@const sp = BOARD[i]}
            <div class="prop-row">
              <span class="dot" style:background={sp.colorGroup ? `var(--${sp.colorGroup})` : 'var(--rail)'}></span>
              <span class="prop-name">{sp.name}</span>
              <span class="houses-label">
                {p.houses === 5 ? 'Hotel' : `${p.houses} houses`}
              </span>
              <button onclick={() => actions.buyHouse({spaceIndex: i})}>+</button>
              <button onclick={() => actions.sellHouse({spaceIndex: i})}>−</button>
            </div>
          {/if}
        {/each}
      </div>
      <p class="builds-hint">Mortgages and Sell-to-Bank live in the Properties panel.</p>
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
  .mortgage-section {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px dashed var(--panel-border);
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .mortgage-label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--ink-mute);
  }
  .term-pills { display: flex; gap: 0.3rem; }
  .term-pill {
    flex: 1;
    padding: 0.25rem 0.4rem;
    font-size: 0.8rem;
    border: 1px solid var(--panel-border);
    background: var(--panel);
    color: inherit;
    border-radius: 4px;
    cursor: pointer;
  }
  .term-pill.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .term-pill[disabled] { opacity: 0.5; cursor: not-allowed; }
  .card-section { gap: 0.25rem; }
  .card-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.3rem 0.45rem;
    border: 1px solid var(--panel-border);
    background: var(--panel);
    color: inherit;
    border-radius: 4px;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .card-row:hover:not([disabled]) { border-color: var(--accent); }
  .card-row[disabled] { opacity: 0.5; cursor: not-allowed; }
  .card-row .card-name { font-weight: 600; }
  .card-row .card-meta { font-family: monospace; color: var(--ink-mute); font-size: 0.72rem; }
  .quote {
    font-family: monospace;
    font-size: 0.78rem;
    color: var(--ink-mute);
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
  .builds-hint { font-size: 0.72rem; color: var(--ink-mute); font-style: italic; margin: 0.4rem 0 0; }
</style>
