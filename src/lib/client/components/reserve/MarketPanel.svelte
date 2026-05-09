<script>
  import { send } from '$lib/client/socket.js';
  import { STOCK_ORDER, STOCK_CATALOG } from '$lib/shared/reserve/stockCatalog.js';
  import StockChart from './StockChart.svelte';

  let { state: gs, mySeat } = $props();

  const me = $derived(gs.seats.find((s) => s.seat === mySeat));
  const market = $derived(gs.stocks?.market ?? {});
  const lots = $derived(me?.stockLots ?? {});
  const basis = $derived(me?.stockCostBasis ?? {});

  let selectedSymbol = $state('TPHT');
  let qty = $state(1);

  const selectedMarket = $derived(market[selectedSymbol]);
  const selectedHistory = $derived(selectedMarket?.history ?? []);
  const selectedPrice = $derived(selectedMarket?.price ?? 0);
  const cost = $derived(Math.round(selectedPrice * qty * 100) / 100);
  const owned = $derived(lots[selectedSymbol] ?? 0);
  const canBuy = $derived(me && me.cash >= cost && qty > 0);
  const canSell = $derived(owned >= qty && qty > 0);

  function buy() {
    if (!canBuy) return;
    send({ type: 'buyStock', symbol: selectedSymbol, qty });
  }
  function sell() {
    if (!canSell) return;
    send({ type: 'sellStock', symbol: selectedSymbol, qty });
  }

  function fmt(v) {
    if (typeof v !== 'number') return '—';
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function pctBetween(from, to) {
    if (typeof from !== 'number' || typeof to !== 'number' || from === 0) return null;
    return Math.round(((to - from) / from) * 1000) / 10;
  }

  function lastFlipPctOf(m) {
    return typeof m?.lastFlipPct === 'number' ? m.lastFlipPct : null;
  }
  function fiveFlipPct(m) {
    const h = m?.history;
    if (!Array.isArray(h) || h.length < 2) return null;
    const last = h[h.length - 1];
    const five = h.length >= 6 ? h[h.length - 6] : h[0];
    return pctBetween(five, last);
  }
  function allTimePct(m) {
    const h = m?.history;
    if (!Array.isArray(h) || h.length < 2) return null;
    return pctBetween(h[0], h[h.length - 1]);
  }
  function fmtPct(p) {
    if (p == null) return '—';
    return (p > 0 ? '+' : '') + p.toFixed(1) + '%';
  }
  function pctClass(p) {
    if (p == null || p === 0) return '';
    return p > 0 ? 'up' : 'down';
  }

  function pl(sym) {
    const own = lots[sym] ?? 0;
    if (!own) return null;
    const cur = (market[sym]?.price ?? 0) * own;
    const b = basis[sym] ?? 0;
    return Math.round((cur - b) * 100) / 100;
  }

  const lastFlipPctSel = $derived(lastFlipPctOf(selectedMarket));
  const fiveFlipPctSel = $derived(fiveFlipPct(selectedMarket));
  const allTimePctSel = $derived(allTimePct(selectedMarket));
</script>

<section class="chart-panel">
  <div class="chart-header">
    <div>
      <h3>{STOCK_CATALOG[selectedSymbol]?.name ?? selectedSymbol}</h3>
      <div class="price">${fmt(selectedPrice)}</div>
    </div>
    <div class="metrics">
      <div class="metric">
        <span class="metric-label">last flip</span>
        <span class={pctClass(lastFlipPctSel)}>{fmtPct(lastFlipPctSel)}</span>
      </div>
      <div class="metric">
        <span class="metric-label">last 5</span>
        <span class={pctClass(fiveFlipPctSel)}>{fmtPct(fiveFlipPctSel)}</span>
      </div>
      <div class="metric">
        <span class="metric-label">all-time</span>
        <span class={pctClass(allTimePctSel)}>{fmtPct(allTimePctSel)}</span>
      </div>
    </div>
  </div>
  <StockChart history={selectedHistory} width={520} height={160} />
</section>

<table class="market">
  <thead>
    <tr>
      <th>Symbol</th>
      <th class="spark-col">Trend</th>
      <th>Price</th>
      <th>Δ%</th>
      <th>Shares</th>
      <th>Value</th>
      <th>P&amp;L</th>
    </tr>
  </thead>
  <tbody>
    {#each STOCK_ORDER as sym (sym)}
      {@const m = market[sym]}
      {@const cat = STOCK_CATALOG[sym]}
      {@const own = lots[sym] ?? 0}
      {@const profit = pl(sym)}
      <tr
        class:selected={selectedSymbol === sym}
        onclick={() => (selectedSymbol = sym)}
      >
        <td><strong>{cat?.name ?? sym}</strong></td>
        <td class="spark-cell">
          <StockChart history={m?.history ?? []} width={80} height={28} showAxis={false} strokeWidth={1.5} />
        </td>
        <td>${fmt(m?.price)}</td>
        <td class:up={(m?.lastFlipPct ?? 0) > 0} class:down={(m?.lastFlipPct ?? 0) < 0}>
          {m?.lastFlipPct ? (m.lastFlipPct > 0 ? '+' : '') + m.lastFlipPct + '%' : '—'}
        </td>
        <td>{own}</td>
        <td>${fmt(own * (m?.price ?? 0))}</td>
        <td class:up={profit > 0} class:down={profit < 0}>
          {profit == null ? '—' : (profit >= 0 ? '+' : '') + '$' + fmt(profit)}
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<div class="trade">
  <h3>Trade {STOCK_CATALOG[selectedSymbol]?.name ?? selectedSymbol}</h3>
  <div class="row">
    <label>
      Qty
      <input type="number" min="1" max="9999" bind:value={qty} />
    </label>
    <div class="cost">
      <div>Price: <strong>${fmt(selectedPrice)}</strong></div>
      <div>Cost: <strong>${fmt(cost)}</strong></div>
      <div>Owned: <strong>{owned}</strong></div>
    </div>
  </div>
  <div class="actions">
    <button class="primary" onclick={buy} disabled={!canBuy}>Buy {qty} share{qty === 1 ? '' : 's'}</button>
    <button onclick={sell} disabled={!canSell}>Sell {qty} share{qty === 1 ? '' : 's'}</button>
  </div>
</div>

{#if gs.stocks?.lastFlip}
  <p class="ink-mute small">
    Last market flip — round {gs.stocks.round}.
  </p>
{/if}

<style>
  .chart-panel {
    margin-top: 0.4rem;
    padding: 0.6rem 0.8rem;
    background: var(--bg);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
  }
  .chart-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.4rem;
    gap: 1rem;
  }
  .chart-header h3 { margin: 0; font-size: 1rem; }
  .chart-header .price { font-family: monospace; font-size: 1.1rem; font-weight: 600; }
  .metrics { display: flex; gap: 0.9rem; font-size: 0.78rem; }
  .metric { display: flex; flex-direction: column; align-items: flex-end; }
  .metric-label { color: var(--ink-mute); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .spark-col { width: 90px; }
  .spark-cell { padding: 0.15rem 0.3rem !important; }
  table.market {
    width: 100%;
    border-collapse: collapse;
    margin: 0.6rem 0;
    font-size: 0.9rem;
  }
  table.market th, table.market td {
    padding: 0.3rem 0.5rem;
    text-align: right;
    border-bottom: 1px solid var(--panel-border);
  }
  table.market th:first-child, table.market td:first-child { text-align: left; }
  table.market tbody tr { cursor: pointer; }
  table.market tbody tr:hover { background: var(--bg); }
  table.market tbody tr.selected { background: rgba(46, 125, 50, 0.12); }
  .up { color: var(--good, #2e7d32); }
  .down { color: var(--danger, #c62828); }
  .trade { padding-top: 0.6rem; border-top: 1px solid var(--panel-border); }
  .trade h3 { margin: 0 0 0.4rem; }
  .row { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; }
  .row label { display: flex; flex-direction: column; font-size: 0.8rem; gap: 0.2rem; }
  .row input { width: 80px; }
  .cost { font-size: 0.9rem; display: flex; gap: 1rem; flex-wrap: wrap; }
  .actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  .actions button { flex: 1; }
  .small { font-size: 0.8rem; }
</style>
