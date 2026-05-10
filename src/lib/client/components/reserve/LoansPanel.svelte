<script>
  import { send } from '$lib/client/socket.js';
  import { getTierByScore, LOAN_TERMS } from '$lib/shared/reserve/loanCatalog.js';
  import { getMaxLineFor } from '$lib/shared/reserve/cardCatalog.js';

  let { state: gs, mySeat } = $props();

  const me = $derived(gs.seats.find((s) => s.seat === mySeat));
  const score = $derived(me?.creditScore ?? 0);
  const tier = $derived(getTierByScore(score));
  const maxLine = $derived(me ? getMaxLineFor(me) : 0);
  const loans = $derived(Array.isArray(me?.loans) ? me.loans : []);
  const activeLoans = $derived(loans.filter((l) => l.status === 'active'));
  const mortgageLoans = $derived(Array.isArray(me?.mortgageLoans) ? me.mortgageLoans : []);
  const activeMortgages = $derived(mortgageLoans.filter((l) => l.status === 'active'));
  const pendingOffer = $derived(me?.pendingLoanOffer ?? null);
  const totalActiveBalance = $derived(
    activeLoans.reduce((acc, l) => acc + (l.balance ?? 0), 0) +
    activeMortgages.reduce((acc, l) => acc + (l.balance ?? 0), 0)
  );

  let amountInput = $state(100);

  function fmt(v) {
    if (typeof v !== 'number') return '—';
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(p) {
    if (typeof p !== 'number') return '—';
    return (p * 100).toFixed(2) + '%';
  }

  function apply() {
    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) return;
    send({ type: 'requestLoan', amount });
  }
  function accept(term) {
    send({ type: 'respondLoanOffer', term });
  }
  function decline() {
    send({ type: 'respondLoanOffer', decline: true });
  }
  function payInstallment(loanId) {
    send({ type: 'payLoanInstallment', loanId });
  }
  function skipInstallment(loanId) {
    send({ type: 'skipLoanInstallment', loanId });
  }
  function payoff(loanId) {
    send({ type: 'payoffLoan', loanId });
  }
  function payMortgage(loanId) {
    send({ type: 'payMortgageInstallment', loanId });
  }
  function skipMortgage(loanId) {
    send({ type: 'skipMortgageInstallment', loanId });
  }
  function payoffMortgage(loanId) {
    send({ type: 'payoffMortgageLoan', loanId });
  }

  const overMax = $derived(Number(amountInput) > maxLine);
  const isPoor = $derived(tier.name === 'Poor');
  const canApply = $derived(
    !isPoor &&
      !pendingOffer &&
      Number(amountInput) > 0 &&
      Number(amountInput) <= maxLine
  );
</script>

<div class="loans">
  <section class="status">
    <div class="status-row">
      <div>
        <div class="label">Credit Score</div>
        <div class="value">{score}</div>
      </div>
      <div>
        <div class="label">Tier</div>
        <div class="value">{tier.name}</div>
      </div>
      <div>
        <div class="label">Max Line</div>
        <div class="value">${fmt(maxLine)}</div>
      </div>
      <div>
        <div class="label">Active Debt</div>
        <div class="value">${fmt(totalActiveBalance)}</div>
      </div>
    </div>
  </section>

  {#if pendingOffer}
    <section class="offer">
      <h3>Loan offer — ${fmt(pendingOffer.principal)}</h3>
      <p class="ink-mute small">
        Banker rolled <strong>{pendingOffer.roll}</strong> at the {pendingOffer.tier} desk.
        Pick a term below or decline.
      </p>
      <div class="offer-grid">
        {#each pendingOffer.options as opt (opt.term)}
          <button class="offer-card" onclick={() => accept(opt.term)}>
            <div class="term">{opt.term} turns</div>
            <div class="ptr">{fmtPct(opt.ptr)} <span class="hint">/turn</span></div>
            <div class="totals">
              <div>Total: <strong>${fmt(opt.totalDebt)}</strong></div>
              <div>Each: <strong>${fmt(opt.installment)}</strong></div>
            </div>
          </button>
        {/each}
      </div>
      <button class="decline" onclick={decline}>Decline offer</button>
    </section>
  {/if}

  <section class="active">
    <h3>Active loans</h3>
    {#if activeLoans.length === 0}
      <p class="empty">No active loans.</p>
    {:else}
      <ul class="loan-list">
        {#each activeLoans as loan (loan.id)}
          <li class="loan" class:due={loan.dueThisTurn}>
            <div class="loan-head">
              <span class="balance">${fmt(loan.balance)}</span>
              {#if loan.source === 'mortgage'}
                <span class="mortgage-tag" title="Buy-with-mortgage">
                  🏠 {loan.propertyName ?? `Space ${loan.propertyIndex}`}
                </span>
              {/if}
              <span class="meta">
                {loan.paymentsMade}/{loan.term} paid · {fmtPct(loan.ptr)}/turn
              </span>
              {#if loan.dueThisTurn}<span class="due-badge">DUE</span>{/if}
            </div>
            <div class="loan-actions">
              <button
                class="primary"
                onclick={() => payInstallment(loan.id)}
                disabled={!loan.dueThisTurn || (me?.cash ?? 0) < Math.min(loan.installment, loan.balance)}
              >
                Pay ${fmt(Math.min(loan.installment, loan.balance))}
              </button>
              <button
                onclick={() => skipInstallment(loan.id)}
                disabled={!loan.dueThisTurn}
                title="Defer this installment for a credit hit"
              >
                Skip (-credit)
              </button>
              <button
                onclick={() => payoff(loan.id)}
                disabled={(me?.cash ?? 0) < loan.balance}
              >
                Pay off ${fmt(loan.balance)}
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="active mortgages">
    <h3>Mortgage loans</h3>
    {#if activeMortgages.length === 0}
      <p class="empty">No mortgage loans. Apply via the Properties panel.</p>
    {:else}
      <ul class="loan-list">
        {#each activeMortgages as loan (loan.id)}
          <li class="loan" class:due={loan.dueThisTurn}>
            <div class="loan-head">
              <span class="balance">${fmt(loan.balance)}</span>
              <span class="mortgage-tag" title="Property mortgage">
                🏠 Space {loan.propertyIndex}
              </span>
              <span class="meta">
                {loan.paymentsMade}/{loan.term} paid · {fmtPct(loan.ptr)}/turn
              </span>
              {#if loan.dueThisTurn}<span class="due-badge">DUE</span>{/if}
            </div>
            <div class="loan-actions">
              <button
                class="primary"
                onclick={() => payMortgage(loan.id)}
                disabled={!loan.dueThisTurn || (me?.cash ?? 0) < Math.min(loan.installment, loan.balance)}
              >
                Pay ${fmt(Math.min(loan.installment, loan.balance))}
              </button>
              <button
                onclick={() => skipMortgage(loan.id)}
                disabled={!loan.dueThisTurn}
                title="Defer this installment for a credit hit"
              >
                Skip (-credit)
              </button>
              <button
                onclick={() => payoffMortgage(loan.id)}
                disabled={(me?.cash ?? 0) < loan.balance}
              >
                Pay off ${fmt(loan.balance)}
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="apply">
    <h3>Apply for a loan</h3>
    {#if isPoor}
      <p class="error">Your credit tier is <strong>Poor</strong>. Loans are unavailable until your score reaches 580.</p>
    {:else}
      <p class="ink-mute small">
        Submit an amount and the bank will roll a die for your rate. You'll see three term options.
      </p>
      <div class="apply-row">
        <label>
          Amount
          <input
            type="number"
            min="1"
            max={maxLine}
            step="1"
            bind:value={amountInput}
          />
        </label>
        <div class="apply-info">
          <div>Max: <strong>${fmt(maxLine)}</strong></div>
          <div class:over={overMax}>
            {overMax ? 'Over max line' : 'Within limit'}
          </div>
        </div>
        <button class="primary" onclick={apply} disabled={!canApply}>Apply</button>
      </div>
    {/if}
  </section>
</div>

<style>
  .loans { display: flex; flex-direction: column; gap: 1rem; }
  section { padding: 0.6rem 0.8rem; background: var(--bg); border: 1px solid var(--panel-border); border-radius: 6px; }
  section h3 { margin: 0 0 0.4rem; font-size: 0.95rem; }

  .status-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.6rem;
    text-align: center;
  }
  .status .label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-mute); }
  .status .value { font-family: monospace; font-size: 1.05rem; font-weight: 600; }

  .offer { border-color: var(--accent); }
  .offer-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    margin: 0.4rem 0;
  }
  .offer-card {
    background: var(--panel);
    border: 2px solid var(--panel-border);
    border-radius: 6px;
    padding: 0.6rem;
    cursor: pointer;
    text-align: center;
    transition: border-color 0.15s ease;
  }
  .offer-card:hover { border-color: var(--accent); }
  .offer-card .term { font-size: 1rem; font-weight: 700; }
  .offer-card .ptr { font-family: monospace; font-size: 1.1rem; margin: 0.2rem 0; }
  .offer-card .ptr .hint { font-size: 0.7rem; color: var(--ink-mute); font-weight: normal; }
  .offer-card .totals { font-size: 0.78rem; }
  .offer .decline { margin-top: 0.4rem; }

  .loan-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .loan { padding: 0.5rem 0.6rem; background: var(--panel); border: 1px solid var(--panel-border); border-radius: 6px; }
  .loan.due { border-color: var(--warn, #ed6c02); background: rgba(237, 108, 2, 0.06); }
  .loan-head { display: flex; align-items: center; gap: 0.6rem; }
  .loan-head .balance { font-family: monospace; font-size: 1.1rem; font-weight: 600; }
  .loan-head .meta { color: var(--ink-mute); font-size: 0.78rem; flex: 1; }
  .mortgage-tag {
    font-size: 0.72rem;
    padding: 0.1rem 0.4rem;
    background: var(--panel-border);
    border-radius: 4px;
    color: var(--ink-mute);
    white-space: nowrap;
  }
  .due-badge {
    background: var(--warn, #ed6c02);
    color: #fff;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    font-size: 0.7rem;
    letter-spacing: 0.04em;
  }
  .loan-actions { display: flex; gap: 0.3rem; margin-top: 0.4rem; flex-wrap: wrap; }
  .loan-actions button { font-size: 0.78rem; padding: 0.3rem 0.5rem; }

  .empty { color: var(--ink-mute); font-style: italic; margin: 0.4rem 0; font-size: 0.85rem; }

  .apply-row {
    display: flex;
    gap: 0.8rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .apply-row label { display: flex; flex-direction: column; font-size: 0.8rem; gap: 0.2rem; }
  .apply-row input { width: 90px; }
  .apply-info { font-size: 0.8rem; flex: 1; min-width: 100px; }
  .apply-info .over { color: var(--danger, #c62828); }
  .small { font-size: 0.78rem; }
  .error { color: var(--danger, #c62828); font-size: 0.85rem; }
</style>
