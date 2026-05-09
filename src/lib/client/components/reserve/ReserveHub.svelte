<script>
  import { ui } from '$lib/client/stores.svelte.js';
  import { HYSA_BASE_RATE } from '$lib/shared/constants.js';
  import { getHysaRateFor } from '$lib/shared/reserve/cardCatalog.js';
  import MarketPanel from './MarketPanel.svelte';
  import LoansPanel from './LoansPanel.svelte';
  import CardsPanel from './CardsPanel.svelte';
  import WirePanel from './WirePanel.svelte';
  import RequestsPanel from './RequestsPanel.svelte';

  let { state: gs, mySeat } = $props();

  const me = $derived(gs.seats.find((s) => s.seat === mySeat));
  const hysaRate = $derived(me ? getHysaRateFor(me, HYSA_BASE_RATE) : 0);

  const TABS = [
    { id: 'market', label: 'Market' },
    { id: 'cards', label: 'Cards' },
    { id: 'loans', label: 'Loans' },
    { id: 'wire', label: 'Wire' },
    { id: 'requests', label: 'Requests' }
  ];

  function setTab(id) {
    ui.reserveTab = id;
  }
  function close() {
    ui.showReserve = false;
  }

  function fmt(v) {
    if (typeof v !== 'number') return '—';
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function tierFor(score) {
    if (typeof score !== 'number') return '—';
    if (score >= 800) return 'Excellent';
    if (score >= 740) return 'Very Good';
    if (score >= 670) return 'Good';
    if (score >= 580) return 'Fair';
    return 'Poor';
  }
</script>

<div class="overlay" onclick={close}>
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <header>
      <h2>Reserve</h2>
      <div class="me-strip">
        <span class="cash">Cash <strong>${fmt(me?.cash)}</strong></span>
        <span class="credit">
          Credit <strong>{me?.creditScore ?? '—'}</strong>
          <span class="tier">({tierFor(me?.creditScore)})</span>
        </span>
        <span class="hysa">HYSA <strong>{(hysaRate * 100).toFixed(1)}%</strong>/turn</span>
      </div>
      <button class="close" onclick={close}>×</button>
    </header>

    <nav class="tabs">
      {#each TABS as t (t.id)}
        <button class:active={ui.reserveTab === t.id} onclick={() => setTab(t.id)}>{t.label}</button>
      {/each}
    </nav>

    <div class="body">
      {#if ui.reserveTab === 'market'}
        <MarketPanel state={gs} {mySeat} />
      {:else if ui.reserveTab === 'cards'}
        <CardsPanel state={gs} {mySeat} />
      {:else if ui.reserveTab === 'loans'}
        <LoansPanel state={gs} {mySeat} />
      {:else if ui.reserveTab === 'wire'}
        <WirePanel state={gs} {mySeat} />
      {:else if ui.reserveTab === 'requests'}
        <RequestsPanel state={gs} {mySeat} />
      {/if}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: var(--panel);
    border: 2px solid var(--line);
    border-radius: 8px;
    padding: 1rem 1.2rem;
    width: 680px;
    max-width: 95vw;
    max-height: 92vh;
    overflow-y: auto;
  }
  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    justify-content: space-between;
    flex-wrap: wrap;
  }
  header h2 { margin: 0; flex-shrink: 0; }
  .me-strip {
    display: flex;
    gap: 1rem;
    font-size: 0.85rem;
    color: var(--ink-mute);
    flex: 1;
  }
  .me-strip strong { color: var(--ink, inherit); font-family: monospace; }
  .me-strip .tier { font-size: 0.75rem; }
  .close { font-size: 1.4rem; padding: 0 0.5rem; cursor: pointer; }

  .tabs {
    display: flex;
    gap: 0.2rem;
    border-bottom: 1px solid var(--panel-border);
    margin: 0.6rem 0;
    flex-wrap: wrap;
  }
  .tabs button {
    background: transparent;
    border: 1px solid transparent;
    border-bottom: none;
    padding: 0.4rem 0.8rem;
    border-radius: 4px 4px 0 0;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .tabs button:hover { background: var(--bg); }
  .tabs button.active {
    background: var(--bg);
    border-color: var(--panel-border);
    font-weight: 600;
    margin-bottom: -1px;
  }

  .body { min-height: 300px; }
</style>
