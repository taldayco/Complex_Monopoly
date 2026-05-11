<script>
  import { fmtPrice as fmt, fmtRate as fmtPct } from '$lib/client/format.js';
  import { actions } from '$lib/client/actions.js';
  import { cents, round4 } from '$lib/shared/money.js';

  let { pending, state, me } = $props();


  const isStockKind = $derived(
    pending.kind === 'stockUpgrade' || pending.kind === 'insiderTip'
  );
  const isLoanKind = $derived(
    pending.kind === 'rateDiscount' || pending.kind === 'refinance'
  );

  const stockOptions = $derived.by(() => {
    if (!isStockKind) return [];
    const market = state?.stocks?.market ?? {};
    return (pending.options ?? []).map((sym) => {
      const price = market[sym]?.price ?? 0;
      const factor = 1 + (typeof pending.amount === 'number' ? pending.amount : 0);
      const previewPrice = Math.max(0.01, cents(price * factor));
      return { sym, price, previewPrice };
    });
  });

  const loanOptions = $derived.by(() => {
    if (!isLoanKind) return [];
    const loans = Array.isArray(me?.loans) ? me.loans : [];
    const optionSet = new Set(pending.options ?? []);
    return loans.filter((l) => optionSet.has(l.id));
  });

  function pickStock(symbol) {
    actions.chooseStockTarget({symbol});
  }
  function pickLoan(loanId) {
    actions.chooseLoanTarget({loanId});
  }
  function skip() {
    actions.skipCardChoice();
  }

  const headerText = $derived.by(() => {
    switch (pending.kind) {
      case 'stockUpgrade': {
        const dir = (pending.amount ?? 0) >= 0 ? 'rises' : 'falls';
        const pct = Math.abs((pending.amount ?? 0) * 100).toFixed(0);
        return `Pick a stock — its price ${dir} ${pct}%`;
      }
      case 'insiderTip':
        return 'Pick a stock — privately reveal its next card';
      case 'rateDiscount': {
        const delta = pending.amount ?? 0;
        const pct = Math.abs(delta * 100).toFixed(2);
        return `Pick a loan — rate ${delta >= 0 ? 'rises' : 'drops'} ${pct}%`;
      }
      case 'refinance':
        return 'Pick a loan — bank re-rolls its rate';
      default:
        return 'Make a choice';
    }
  });
</script>

<div class="overlay">
  <div class="modal">
    <h2>{headerText}</h2>

    {#if isStockKind}
      <div class="options">
        {#each stockOptions as opt (opt.sym)}
          <button class="opt" onclick={() => pickStock(opt.sym)}>
            <span class="sym">{opt.sym}</span>
            <span class="now">${fmt(opt.price)}</span>
            {#if pending.kind === 'stockUpgrade'}
              <span class="arrow">→</span>
              <span class="next" class:up={opt.previewPrice > opt.price} class:down={opt.previewPrice < opt.price}>
                ${fmt(opt.previewPrice)}
              </span>
            {/if}
          </button>
        {/each}
      </div>
    {:else if isLoanKind}
      {#if loanOptions.length === 0}
        <p class="empty">No eligible loans.</p>
      {:else}
        <div class="options">
          {#each loanOptions as loan (loan.id)}
            {@const newPtr = pending.kind === 'rateDiscount'
              ? Math.max(0, round4(loan.ptr + (pending.amount ?? 0)))
              : null}
            <button class="opt loan-opt" onclick={() => pickLoan(loan.id)}>
              <div class="loan-head">
                <span class="balance">${fmt(loan.balance)}</span>
                <span class="meta">{loan.paymentsMade}/{loan.term} paid</span>
              </div>
              <div class="loan-rate">
                <span>Rate {fmtPct(loan.ptr)}/turn</span>
                {#if newPtr != null}
                  <span class="arrow">→</span>
                  <span class:down={newPtr < loan.ptr}>{fmtPct(newPtr)}</span>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      {/if}
    {:else}
      <p class="empty">Unknown choice kind: {pending.kind}</p>
    {/if}

    <button class="skip" onclick={skip}>Skip</button>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: var(--panel);
    border: 2px solid var(--accent);
    border-radius: 8px;
    padding: 1.3rem;
    width: 480px;
    max-width: 92vw;
    max-height: 86vh;
    overflow-y: auto;
  }
  h2 { margin: 0 0 0.8rem; font-size: 1.05rem; }
  .options { display: flex; flex-direction: column; gap: 0.4rem; }
  .opt {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    color: inherit;
    cursor: pointer;
    font-size: 0.88rem;
    text-align: left;
  }
  .opt:hover { border-color: var(--accent); }
  .sym { font-weight: 700; font-family: monospace; min-width: 56px; }
  .now, .next { font-family: monospace; }
  .arrow { color: var(--ink-mute); }
  .next.up { color: var(--good, #2e7d32); }
  .next.down { color: var(--danger, #c62828); }
  .loan-opt { flex-direction: column; align-items: stretch; gap: 0.25rem; }
  .loan-head { display: flex; align-items: center; gap: 0.6rem; }
  .balance { font-family: monospace; font-weight: 600; flex: 1; }
  .meta { color: var(--ink-mute); font-size: 0.78rem; }
  .loan-rate {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-family: monospace;
    font-size: 0.82rem;
  }
  .loan-rate .down { color: var(--good, #2e7d32); }
  .empty { color: var(--ink-mute); font-style: italic; margin: 0.5rem 0; }
  .skip { margin-top: 1rem; width: 100%; }
</style>
