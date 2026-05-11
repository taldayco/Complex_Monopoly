<script>
  import { fmtCash as fmt } from '$lib/client/format.js';
  import { actions } from '$lib/client/actions.js';
  import {
    CARD_CATALOG,
    CARD_ORDER,
    getCard,
    meetsTierRequirement
  } from '$lib/shared/reserve/cardCatalog.js';
  import { getTierByScore } from '$lib/shared/reserve/loanCatalog.js';

  let { state: gs, mySeat } = $props();

  const me = $derived(gs.seats.find((s) => s.seat === mySeat));
  const tier = $derived(getTierByScore(me?.creditScore ?? 0));
  const owned = $derived(
    Array.isArray(me?.creditCards) ? me.creditCards.filter((c) => c.status === 'active') : []
  );
  const ownedCardIds = $derived(new Set(owned.map((o) => o.cardId)));


  function apply(cardId) {
    actions.requestCreditCard({cardId});
  }
  function cancel(instanceId) {
    actions.cancelCreditCard({instanceId});
  }

  // Per-card pay-amount input. Keyed by instance id so two open cards keep
  // independent values.
  let payAmounts = $state({});
  function pay(instanceId) {
    const amount = Number(payAmounts[instanceId]);
    if (!(amount > 0)) return;
    actions.payCardBalance({instanceId, amount});
    payAmounts[instanceId] = '';
  }

  function eligibility(card) {
    if (ownedCardIds.has(card.id)) return { ok: false, reason: 'You already hold this card.' };
    if (!meetsTierRequirement(me ?? {}, card.requiredTier)) {
      return { ok: false, reason: `Requires ${card.requiredTier} credit (you are ${tier.name}).` };
    }
    if ((me?.cash ?? 0) < card.signingFee) {
      return { ok: false, reason: `Need $${fmt(card.signingFee)} for signing fee.` };
    }
    return { ok: true };
  }
</script>

<div class="cards">
  <section class="owned">
    <h3>Your cards</h3>
    {#if owned.length === 0}
      <p class="empty">You hold no credit cards.</p>
    {:else}
      <ul>
        {#each owned as inst (inst.id)}
          {@const card = getCard(inst.cardId)}
          {#if card}
            {@const balance = inst.balance ?? 0}
            {@const limit = card.minLine ?? 0}
            {@const available = Math.max(0, limit - balance)}
            <li>
              <div class="head">
                <strong>{card.name}</strong>
                <span class="fee">{Math.round((card.interestRate ?? 0) * 100)}% / 4t</span>
              </div>
              <div class="balance-line">
                <span>Balance: <strong class:has-balance={balance > 0}>${fmt(balance)}</strong> / ${fmt(limit)}</span>
                <span class="ink-mute small">${fmt(available)} available</span>
              </div>
              <p class="blurb">{card.blurb}</p>
              {#if balance > 0}
                <div class="pay-row">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Amount"
                    bind:value={payAmounts[inst.id]}
                  />
                  <button
                    class="primary"
                    onclick={() => pay(inst.id)}
                    disabled={!(Number(payAmounts[inst.id]) > 0) || (me?.cash ?? 0) < Number(payAmounts[inst.id])}
                  >
                    Pay
                  </button>
                  <button
                    onclick={() => { payAmounts[inst.id] = balance; pay(inst.id); }}
                    disabled={(me?.cash ?? 0) < balance}
                    title={(me?.cash ?? 0) < balance ? `Need $${fmt(balance)} cash` : 'Pay full balance'}
                  >
                    Pay full
                  </button>
                </div>
              {/if}
              <button
                class="cancel-btn"
                onclick={() => cancel(inst.id)}
                disabled={(me?.cash ?? 0) < card.cancelFee || balance > 0}
                title={balance > 0 ? 'Pay off the balance before cancelling' : ''}
              >
                Cancel — ${fmt(card.cancelFee)}
              </button>
            </li>
          {/if}
        {/each}
      </ul>
    {/if}
  </section>

  <section class="catalog">
    <h3>Available cards</h3>
    <p class="ink-mute small">
      Each card charges a signing fee on issue and a per-turn rotating fee. If you can't pay
      the rotating fee on a turn, the card auto-cancels.
    </p>
    <ul class="card-grid">
      {#each CARD_ORDER as cid (cid)}
        {@const card = CARD_CATALOG[cid]}
        {@const elig = eligibility(card)}
        <li class="card" class:owned={ownedCardIds.has(cid)} class:locked={!elig.ok && !ownedCardIds.has(cid)}>
          <header>
            <strong>{card.name}</strong>
            <span class="tier-tag">{card.requiredTier}+</span>
          </header>
          {#if card.bank}
            <p class="bank">{card.bank}</p>
          {/if}
          <p class="blurb">{card.blurb}</p>
          <ul class="fees">
            <li>Sign: <strong>${fmt(card.signingFee)}</strong></li>
            <li>GO: <strong>${fmt(card.goFee ?? 0)}</strong></li>
            <li>Cancel: <strong>${fmt(card.cancelFee)}</strong></li>
            {#if card.signupBonus > 0}
              <li class="bonus">Bonus: <strong>+${fmt(card.signupBonus)}</strong></li>
            {/if}
          </ul>
          <ul class="fees">
            <li>Line: <strong>${fmt(card.minLine ?? 0)}</strong></li>
            <li>APR: <strong>{Math.round((card.interestRate ?? 0) * 100)}%/4t</strong></li>
            <li>Min Pay: <strong>${fmt(card.minPayment ?? 0)}</strong></li>
          </ul>
          {#if ownedCardIds.has(cid)}
            <span class="status-tag owned-tag">Owned</span>
          {:else if !elig.ok}
            <span class="status-tag locked-tag" title={elig.reason}>{elig.reason}</span>
          {:else}
            <button class="primary apply-btn" onclick={() => apply(cid)}>
              Apply — ${fmt(card.signingFee)}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
</div>

<style>
  .cards { display: flex; flex-direction: column; gap: 1rem; }
  section { padding: 0.6rem 0.8rem; background: var(--bg); border: 1px solid var(--panel-border); border-radius: 6px; }
  section h3 { margin: 0 0 0.4rem; font-size: 0.95rem; }

  .owned ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .owned li { background: var(--panel); border: 1px solid var(--panel-border); border-radius: 6px; padding: 0.5rem 0.6rem; }
  .owned .head { display: flex; justify-content: space-between; align-items: center; }
  .owned .fee { font-family: monospace; font-size: 0.85rem; color: var(--ink-mute); }
  .owned .blurb { margin: 0.3rem 0; font-size: 0.82rem; color: var(--ink-mute); }
  .owned button { font-size: 0.78rem; }
  .balance-line {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    margin-top: 0.25rem;
    font-family: monospace;
  }
  .balance-line .has-balance { color: var(--danger, #c62828); }
  .pay-row {
    display: flex;
    gap: 0.3rem;
    margin: 0.4rem 0 0.3rem;
    align-items: center;
  }
  .pay-row input {
    flex: 1;
    min-width: 0;
    padding: 0.2rem 0.4rem;
    font-size: 0.8rem;
  }
  .pay-row button { flex: 0 0 auto; }
  .cancel-btn { width: 100%; margin-top: 0.2rem; }
  .small { font-size: 0.75rem; }
  .empty { color: var(--ink-mute); font-style: italic; margin: 0.4rem 0; font-size: 0.85rem; }

  .card-grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.6rem;
  }
  .card {
    background: var(--panel);
    border: 2px solid var(--panel-border);
    border-radius: 6px;
    padding: 0.6rem 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    transition: border-color 0.15s ease;
  }
  .card.owned { border-color: var(--good, #2e7d32); }
  .card.locked { opacity: 0.7; }
  .card header { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
  .card header strong { font-size: 0.9rem; }
  .tier-tag {
    background: var(--accent);
    color: #fff;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    font-size: 0.65rem;
    letter-spacing: 0.04em;
  }
  .card .bank { font-size: 0.7rem; color: var(--ink-mute); margin: 0; font-style: italic; letter-spacing: 0.02em; }
  .card .blurb { font-size: 0.78rem; color: var(--ink-mute); margin: 0; min-height: 2.4em; }
  .card .fees { list-style: none; padding: 0; margin: 0; font-size: 0.75rem; display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .card .fees li.bonus { color: var(--good, #2e7d32); }
  .status-tag { font-size: 0.72rem; color: var(--ink-mute); font-style: italic; }
  .status-tag.owned-tag { color: var(--good, #2e7d32); font-weight: 600; }
  .apply-btn { font-size: 0.8rem; }
  .small { font-size: 0.78rem; }
</style>
