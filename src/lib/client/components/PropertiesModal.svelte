<script>
  import { send } from '$lib/client/socket.js';
  import { ui } from '$lib/client/stores.svelte.js';
  import { BOARD, isOwnable } from '$lib/shared/board.js';
  import { COLOR_GROUPS } from '$lib/shared/constants.js';
  import {
    MORTGAGE_TIER_RATES,
    MORTGAGE_TERMS,
    MORTGAGE_MAX_DOWN_PAYMENT,
    downPaymentDiscount
  } from '$lib/engine/mortgage.js';
  import { getTierByScore } from '$lib/shared/reserve/loanCatalog.js';

  let { state: gs, mySeat } = $props();

  const me = $derived(gs.seats.find((s) => s.seat === mySeat));
  const myTier = $derived(getTierByScore(me?.creditScore ?? 0));
  const mortgageEligible = $derived(
    !!MORTGAGE_TIER_RATES[myTier.name]
  );

  let openApplyFor = $state(null);
  let applyTerm = $state(MORTGAGE_TERMS[0]);
  let applyDownPct = $state(0);

  function openApply(idx) {
    openApplyFor = idx;
    applyTerm = MORTGAGE_TERMS[0];
    applyDownPct = 0;
  }
  function closeApply() {
    openApplyFor = null;
  }
  function submitApply(idx) {
    send({
      type: 'requestMortgageLoan',
      spaceIndex: idx,
      term: applyTerm,
      downPaymentPct: applyDownPct
    });
    openApplyFor = null;
  }

  function applyPreview(spaceIndex) {
    const sp = BOARD[spaceIndex];
    if (!sp || !mortgageEligible) return null;
    const baseRate = MORTGAGE_TIER_RATES[myTier.name][applyTerm];
    const reserveRate = gs.economy?.reserveRate ?? 0;
    const dpDiscount = downPaymentDiscount(applyDownPct);
    const ptr = Math.max(0, Math.round((baseRate + reserveRate - dpDiscount) * 10000) / 10000);
    const downPayment = Math.round((sp.mortgageValue ?? 0) * applyDownPct * 100) / 100;
    const principal = Math.round((sp.mortgageValue ?? 0) * (1 - applyDownPct) * 100) / 100;
    const totalDebt = Math.round(principal * (1 + ptr * applyTerm) * 100) / 100;
    const installment = Math.round((totalDebt / applyTerm) * 100) / 100;
    return { ptr, downPayment, principal, totalDebt, installment };
  }

  const rows = $derived.by(() => {
    if (!me) return [];
    const out = [];
    for (const [iStr, p] of Object.entries(gs.properties ?? {})) {
      if (p.ownerSeat !== mySeat) continue;
      const i = Number(iStr);
      const sp = BOARD[i];
      if (!sp || !isOwnable(sp)) continue;
      const mortgageValue = sp.mortgageValue ?? 0;
      const groupHasHouses =
        sp.type === 'property'
          ? (COLOR_GROUPS[sp.colorGroup] ?? []).some((idx) => (gs.properties[idx]?.houses ?? 0) > 0)
          : false;
      out.push({
        i,
        name: sp.name,
        colorGroup: sp.colorGroup ?? null,
        type: sp.type,
        houses: p.houses ?? 0,
        mortgaged: !!p.mortgaged,
        mortgageValue,
        groupHasHouses
      });
    }
    return out.sort((a, b) => a.i - b.i);
  });

  function fmt(v) {
    if (typeof v !== 'number') return '—';
    return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function close() {
    ui.showPropertiesModal = false;
  }

  function sell(i, name) {
    if (!confirm(`Sell ${name} back to the bank?`)) return;
    send({ type: 'sellPropertyToBank', spaceIndex: i });
  }

  function houseLabel(r) {
    if (r.type !== 'property') return '—';
    if (r.houses === 5) return 'Hotel';
    return r.houses === 0 ? '—' : `${r.houses} house${r.houses === 1 ? '' : 's'}`;
  }
</script>

<div class="overlay" onclick={close} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
    <header>
      <h2>My Properties</h2>
      <span class="cash">Cash <strong>${fmt(me?.cash)}</strong></span>
      <button class="close" onclick={close} aria-label="Close">×</button>
    </header>

    {#if rows.length === 0}
      <p class="empty">You don't own any properties yet.</p>
    {:else}
      <table class="prop-table">
        <thead>
          <tr>
            <th>Property</th>
            <th>Houses</th>
            <th>State</th>
            <th class="num">Mortgage Value</th>
            <th class="actions-col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.i)}
            <tr>
              <td>
                <span
                  class="dot"
                  style:background={r.colorGroup ? `var(--${r.colorGroup})` : 'var(--rail, #888)'}
                ></span>
                {r.name}
              </td>
              <td>{houseLabel(r)}</td>
              <td>
                {#if r.mortgaged}
                  <span class="tag mortgaged">Mortgaged</span>
                {:else}
                  <span class="tag active">Active</span>
                {/if}
              </td>
              <td class="num">${fmt(r.mortgageValue)}</td>
              <td class="actions-col">
                {#if !r.mortgaged}
                  <button
                    onclick={() => openApply(r.i)}
                    disabled={r.houses > 0 || r.groupHasHouses || !mortgageEligible}
                    title={!mortgageEligible
                      ? `Credit tier ${myTier.name} is ineligible for mortgage loans`
                      : (r.houses > 0
                        ? 'Sell houses first'
                        : (r.groupHasHouses ? 'Group has houses' : ''))}
                  >
                    Mortgage…
                  </button>
                  <button
                    class="sell"
                    onclick={() => sell(r.i, r.name)}
                    disabled={r.houses > 0 || r.groupHasHouses}
                    title={r.houses > 0 ? 'Sell houses first' : (r.groupHasHouses ? 'Group has houses' : '')}
                  >
                    Sell to Bank
                  </button>
                {:else}
                  <span class="locked-note">Loan active — repay in Reserve › Loans</span>
                {/if}
              </td>
            </tr>
            {#if openApplyFor === r.i}
              {@const preview = applyPreview(r.i)}
              <tr class="apply-row">
                <td colspan="5">
                  <div class="apply-form">
                    <div class="apply-head">
                      Apply for mortgage loan on <strong>{r.name}</strong>
                      (value ${fmt(r.mortgageValue)})
                    </div>
                    <div class="apply-controls">
                      <label>
                        Term
                        <select bind:value={applyTerm}>
                          {#each MORTGAGE_TERMS as t}<option value={t}>{t} turns</option>{/each}
                        </select>
                      </label>
                      <label class="dp-label">
                        Down payment {Math.round(applyDownPct * 100)}%
                        <input
                          type="range"
                          min="0"
                          max={MORTGAGE_MAX_DOWN_PAYMENT}
                          step="0.05"
                          bind:value={applyDownPct}
                        />
                      </label>
                    </div>
                    {#if preview}
                      <div class="preview">
                        <span>Rate <strong>{(preview.ptr * 100).toFixed(2)}%</strong>/turn</span>
                        <span>Down <strong>${fmt(preview.downPayment)}</strong></span>
                        <span>Principal <strong>${fmt(preview.principal)}</strong></span>
                        <span>Installment <strong>${fmt(preview.installment)}</strong> × {applyTerm}</span>
                        <span>Total <strong>${fmt(preview.totalDebt)}</strong></span>
                      </div>
                    {/if}
                    <div class="apply-actions">
                      <button onclick={closeApply}>Cancel</button>
                      <button
                        class="primary"
                        onclick={() => submitApply(r.i)}
                        disabled={!preview || (me?.cash ?? 0) < (preview?.downPayment ?? 0)}
                      >
                        Take loan
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
      <p class="hint">
        A mortgage loan creates structured installments against a property using
        it as collateral. Selling returns the property to the bank for its
        mortgage value (no houses, no group with houses, no active mortgage).
      </p>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 210;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: var(--panel);
    border: 2px solid var(--line, var(--accent));
    border-radius: 8px;
    padding: 1rem 1.2rem;
    width: 720px;
    max-width: 96vw;
    max-height: 92vh;
    overflow-y: auto;
  }
  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.6rem;
  }
  header h2 { margin: 0; flex: 1; }
  .cash { font-size: 0.85rem; color: var(--ink-mute); }
  .cash strong { color: var(--ink, inherit); font-family: monospace; }
  .close { font-size: 1.4rem; padding: 0 0.5rem; cursor: pointer; }
  .empty { color: var(--ink-mute); font-style: italic; padding: 1rem 0; text-align: center; }
  .prop-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  .prop-table th, .prop-table td {
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--panel-border);
    text-align: left;
    vertical-align: middle;
  }
  .prop-table th.num, .prop-table td.num { text-align: right; font-family: monospace; }
  .prop-table th.actions-col, .prop-table td.actions-col { text-align: right; }
  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 1px solid #000;
    margin-right: 0.4rem;
    vertical-align: middle;
  }
  .tag {
    font-size: 0.7rem;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .tag.active { background: rgba(46, 125, 50, 0.15); color: var(--good, #2e7d32); }
  .tag.mortgaged { background: rgba(198, 40, 40, 0.12); color: var(--danger, #c62828); }
  .actions-col button {
    font-size: 0.78rem;
    padding: 0.3rem 0.5rem;
    margin-left: 0.3rem;
    cursor: pointer;
  }
  .actions-col button:disabled { opacity: 0.5; cursor: not-allowed; }
  .actions-col button.sell {
    background: var(--danger, #c62828);
    color: #fff;
    border: 1px solid var(--danger, #c62828);
  }
  .actions-col button.sell:hover:not(:disabled) { filter: brightness(1.1); }
  .hint {
    margin: 0.6rem 0 0;
    font-size: 0.78rem;
    color: var(--ink-mute);
    font-style: italic;
  }
  .locked-note {
    font-size: 0.72rem;
    color: var(--ink-mute);
    font-style: italic;
  }
  .apply-row td {
    background: rgba(46, 125, 50, 0.05);
    border-bottom: 2px solid var(--accent);
  }
  .apply-form { display: flex; flex-direction: column; gap: 0.5rem; }
  .apply-head { font-size: 0.85rem; }
  .apply-controls {
    display: flex;
    gap: 1rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .apply-controls label {
    display: flex;
    flex-direction: column;
    font-size: 0.78rem;
    gap: 0.2rem;
  }
  .dp-label input { width: 200px; }
  .preview {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    font-size: 0.8rem;
    font-family: monospace;
    color: var(--ink-mute);
  }
  .preview strong { color: var(--ink, inherit); }
  .apply-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }
</style>
