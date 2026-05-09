<script>
  import { send } from '$lib/client/socket.js';
  import { ui } from '$lib/client/stores.svelte.js';
  import { BOARD, isOwnable } from '$lib/shared/board.js';
  import { COLOR_GROUPS, MORTGAGE_INTEREST } from '$lib/shared/constants.js';

  let { state: gs, mySeat } = $props();

  const me = $derived(gs.seats.find((s) => s.seat === mySeat));

  // Each owned property as a fully-resolved row.
  const rows = $derived.by(() => {
    if (!me) return [];
    const out = [];
    for (const [iStr, p] of Object.entries(gs.properties ?? {})) {
      if (p.ownerSeat !== mySeat) continue;
      const i = Number(iStr);
      const sp = BOARD[i];
      if (!sp || !isOwnable(sp)) continue;
      const mortgageValue = sp.mortgageValue ?? 0;
      const unmortgageCost = Math.ceil(mortgageValue * (1 + MORTGAGE_INTEREST));
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
        unmortgageCost,
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

  function mortgage(i) {
    send({ type: 'mortgage', spaceIndex: i });
  }
  function unmortgage(i) {
    send({ type: 'unmortgage', spaceIndex: i });
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
            <th class="num">Mortgage</th>
            <th class="num">Unmortgage</th>
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
              <td class="num">${fmt(r.unmortgageCost)}</td>
              <td class="actions-col">
                {#if r.mortgaged}
                  <button
                    onclick={() => unmortgage(r.i)}
                    disabled={(me?.cash ?? 0) < r.unmortgageCost}
                    title={(me?.cash ?? 0) < r.unmortgageCost ? 'Insufficient cash' : ''}
                  >
                    Unmortgage
                  </button>
                {:else}
                  <button
                    onclick={() => mortgage(r.i)}
                    disabled={r.houses > 0 || r.groupHasHouses}
                    title={r.houses > 0 ? 'Sell houses first' : (r.groupHasHouses ? 'Group has houses' : '')}
                  >
                    Mortgage
                  </button>
                  <button
                    class="sell"
                    onclick={() => sell(r.i, r.name)}
                    disabled={r.houses > 0 || r.groupHasHouses}
                    title={r.houses > 0 ? 'Sell houses first' : (r.groupHasHouses ? 'Group has houses' : '')}
                  >
                    Sell to Bank
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="hint">
        Selling a property returns it to the bank for its mortgage value
        (${fmt(rows[0]?.mortgageValue)}–${fmt(rows[rows.length - 1]?.mortgageValue)} per tile).
        It must not be mortgaged or have houses, and the color group must have no houses.
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
</style>
