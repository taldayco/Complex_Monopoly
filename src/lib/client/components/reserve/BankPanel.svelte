<script>
  import { fmtPrice as fmt, fmtRate as fmtPct } from '$lib/client/format.js';
  import { actions } from '$lib/client/actions.js';
  import { BANKS, BANK_IDS } from '$lib/shared/reserve/economyCatalog.js';
  import { CARD_CATALOG, getHysaRateFor } from '$lib/shared/reserve/cardCatalog.js';

  let { state: gs, mySeat } = $props();

  const me = $derived(gs.seats.find((s) => s.seat === mySeat));
  const reserveRate = $derived(gs.economy?.reserveRate ?? 0);
  const cardHysaBonus = $derived(me ? getHysaRateFor(me, 0) : 0);
  const otherSeats = $derived(
    gs.seats.filter((s) => s.seat !== mySeat && !s.bankrupt)
  );

  let activeTab = $state('accounts');
  let depositInputs = $state({ mmcu: 100, boardwalk: 100 });
  let withdrawInputs = $state({ mmcu: 100, boardwalk: 100 });
  let wireToSeat = $state(otherSeats[0]?.seat ?? null);
  let wireAmount = $state(50);

  $effect(() => {
    if (otherSeats.length === 0) {
      wireToSeat = null;
      return;
    }
    if (!otherSeats.some((s) => s.seat === wireToSeat)) {
      wireToSeat = otherSeats[0].seat;
    }
  });



  function accountFor(bank) {
    return me?.bankAccounts?.[bank] ?? { open: false, balance: 0, openedAt: 0 };
  }

  function hysaRateFor(bank) {
    const baseRate = reserveRate + BANKS[bank].hysaSpread;
    return Math.max(0, baseRate + cardHysaBonus);
  }

  function hasActiveLoanAtBank(bank) {
    if (!Array.isArray(me?.loans)) return false;
    return me.loans.some((l) => l && l.status === 'active' && l.bank === bank);
  }

  function hasActiveCardAtBank(bank) {
    if (!Array.isArray(me?.creditCards)) return false;
    return me.creditCards.some((c) => {
      if (!c || c.status !== 'active') return false;
      const cat = CARD_CATALOG[c.cardId];
      if (!cat) return false;
      if (bank === 'mmcu') return cat.bank === 'MM Credit Union';
      if (bank === 'boardwalk') return cat.bank === 'Boardwalk National Bank';
      return false;
    });
  }

  function closeReason(bank) {
    const acct = accountFor(bank);
    if ((acct.balance ?? 0) > 0) return 'Withdraw balance first';
    if (hasActiveLoanAtBank(bank)) return 'Active loan at this bank';
    if (hasActiveCardAtBank(bank)) return 'Active card at this bank';
    return null;
  }

  function open(bank) {
    actions.openBankAccount({bank});
  }
  function close(bank) {
    actions.closeBankAccount({bank});
  }
  function deposit(bank) {
    const amount = Number(depositInputs[bank]);
    if (!Number.isFinite(amount) || amount <= 0) return;
    actions.depositToBank({bank, amount});
  }
  function withdraw(bank) {
    const amount = Number(withdrawInputs[bank]);
    if (!Number.isFinite(amount) || amount <= 0) return;
    actions.withdrawFromBank({bank, amount});
  }
  function wire() {
    const amt = Number(wireAmount);
    if (!Number.isFinite(amt) || amt <= 0 || wireToSeat == null) return;
    actions.wireTransfer({toSeat: wireToSeat, amount: amt});
    wireAmount = 50;
  }

  const wireTarget = $derived(otherSeats.find((s) => s.seat === wireToSeat));
  const canWire = $derived(
    me &&
      wireTarget &&
      Number(wireAmount) > 0 &&
      Number(wireAmount) <= (me.cash ?? 0)
  );
</script>

<div class="bank">
  <nav class="subtabs">
    <button class:active={activeTab === 'accounts'} onclick={() => (activeTab = 'accounts')}>
      Accounts
    </button>
    <button class:active={activeTab === 'wire'} onclick={() => (activeTab = 'wire')}>
      Wire
    </button>
  </nav>

  {#if activeTab === 'accounts'}
    <p class="cash-line">Cash on hand: <strong>${fmt(me?.cash)}</strong></p>

    {#each BANK_IDS as bank (bank)}
      {@const acct = accountFor(bank)}
      {@const cap = BANKS[bank].maxWithdrawal}
      {@const rate = hysaRateFor(bank)}
      {@const closeBlock = closeReason(bank)}
      <section class="bank-section">
        <header>
          <div>
            <h3>{BANKS[bank].name}</h3>
            <p class="meta">
              {acct.open ? 'Open' : 'Closed'} · HYSA {fmtPct(rate)}/turn · max withdrawal ${fmt(cap)}
            </p>
          </div>
          <div class="balance">
            <span class="label">Balance</span>
            <strong>${fmt(acct.balance ?? 0)}</strong>
          </div>
        </header>

        {#if !acct.open}
          <div class="actions">
            <button class="primary" onclick={() => open(bank)}>Open account</button>
          </div>
        {:else}
          <div class="form-grid">
            <label>
              Deposit
              <input
                type="number"
                min="1"
                step="1"
                bind:value={depositInputs[bank]}
              />
            </label>
            <button
              onclick={() => deposit(bank)}
              disabled={!(Number(depositInputs[bank]) > 0 && Number(depositInputs[bank]) <= (me?.cash ?? 0))}
            >
              Deposit ${fmt(Number(depositInputs[bank]) || 0)}
            </button>

            <label>
              Withdraw
              <input
                type="number"
                min="1"
                step="1"
                bind:value={withdrawInputs[bank]}
              />
            </label>
            <button
              onclick={() => withdraw(bank)}
              disabled={!(
                Number(withdrawInputs[bank]) > 0 &&
                Number(withdrawInputs[bank]) <= (acct.balance ?? 0) &&
                Number(withdrawInputs[bank]) <= cap
              )}
            >
              Withdraw ${fmt(Number(withdrawInputs[bank]) || 0)}
            </button>
          </div>

          <div class="actions">
            <button
              class="danger"
              onclick={() => close(bank)}
              disabled={closeBlock !== null}
              title={closeBlock ?? ''}
            >
              Close account{closeBlock ? ` — ${closeBlock}` : ''}
            </button>
          </div>
        {/if}
      </section>
    {/each}
  {:else}
    <section class="wire-section">
      <h3>Wire cash to a player</h3>
      <p class="ink-mute small">
        Instant transfer from your cash to another player. No approval required.
      </p>
      {#if otherSeats.length === 0}
        <p class="empty">No other active players.</p>
      {:else}
        <div class="wire-form">
          <label>
            To
            <select bind:value={wireToSeat}>
              {#each otherSeats as s (s.seat)}
                <option value={s.seat}>{s.name} — ${fmt(s.cash)}</option>
              {/each}
            </select>
          </label>
          <label>
            Amount
            <input type="number" min="1" step="1" bind:value={wireAmount} />
          </label>
          <button class="primary" onclick={wire} disabled={!canWire}>
            Send ${fmt(Number(wireAmount) || 0)}
          </button>
        </div>
        <p class="balance-line">Your cash: <strong>${fmt(me?.cash)}</strong></p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .bank { display: flex; flex-direction: column; gap: 0.8rem; }
  .subtabs { display: flex; gap: 0.4rem; border-bottom: 1px solid var(--panel-border); }
  .subtabs button {
    background: transparent;
    border: 1px solid transparent;
    border-bottom: none;
    padding: 0.35rem 0.7rem;
    border-radius: 4px 4px 0 0;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .subtabs button:hover { background: var(--bg); }
  .subtabs button.active {
    background: var(--bg);
    border-color: var(--panel-border);
    font-weight: 600;
    margin-bottom: -1px;
  }
  .cash-line { margin: 0; font-size: 0.85rem; color: var(--ink-mute); }
  .cash-line strong { font-family: monospace; color: var(--ink, inherit); }
  .bank-section {
    padding: 0.7rem 0.9rem;
    background: var(--bg);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
  }
  .bank-section header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 0.6rem;
  }
  .bank-section h3 { margin: 0 0 0.15rem; font-size: 1rem; }
  .bank-section .meta { margin: 0; font-size: 0.78rem; color: var(--ink-mute); }
  .balance { text-align: right; }
  .balance .label { display: block; font-size: 0.7rem; color: var(--ink-mute); }
  .balance strong { font-family: monospace; font-size: 1rem; }
  .form-grid {
    display: grid;
    grid-template-columns: 2fr auto;
    gap: 0.5rem 0.7rem;
    align-items: end;
    margin-bottom: 0.6rem;
  }
  .form-grid label { display: flex; flex-direction: column; font-size: 0.75rem; gap: 0.2rem; }
  .form-grid input { padding: 0.3rem; }
  .actions { display: flex; gap: 0.5rem; }
  .danger {
    background: transparent;
    border: 1px solid var(--panel-border);
    color: var(--ink-mute);
    padding: 0.3rem 0.6rem;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .danger:not(:disabled):hover { background: var(--bg); color: var(--ink, inherit); }
  .danger:disabled { cursor: not-allowed; opacity: 0.6; }
  .wire-section {
    padding: 0.7rem 0.9rem;
    background: var(--bg);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
  }
  .wire-section h3 { margin: 0 0 0.4rem; font-size: 0.95rem; }
  .wire-form { display: grid; grid-template-columns: 2fr 1fr auto; gap: 0.6rem; align-items: end; }
  .wire-form label { display: flex; flex-direction: column; font-size: 0.78rem; gap: 0.2rem; }
  .wire-form input, .wire-form select { padding: 0.3rem; }
  .balance-line { margin: 0.4rem 0 0; font-size: 0.85rem; color: var(--ink-mute); }
  .empty { color: var(--ink-mute); font-style: italic; margin: 0.4rem 0; font-size: 0.85rem; }
  .small { font-size: 0.78rem; }
</style>
