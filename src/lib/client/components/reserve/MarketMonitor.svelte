<script>
  import { ui } from '$lib/client/stores.svelte.js';
  import { send } from '$lib/client/socket.js';
  import { STOCK_ORDER, STOCK_CATALOG } from '$lib/shared/reserve/stockCatalog.js';
  import StockChart from './StockChart.svelte';

  let { state: gs, mySeat, locked = false } = $props();

  const market = $derived(gs.stocks?.market ?? {});
  const me = $derived(gs.seats?.find((s) => s.seat === mySeat));
  const revealed = $derived(me?.revealedWildcards ?? {});
  const marketOpen = $derived(gs.marketOpen ?? null);
  const marketOpenActive = $derived(!!marketOpen?.active);

  // Per-stock trade quantity inputs. Default 1; user-editable.
  let tradeQty = $state({});
  function qtyFor(sym) {
    const v = Number(tradeQty[sym]);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 1;
  }

  // Wall-clock for the countdown. Re-tick while a Market Open window is live;
  // pause otherwise so we don't burn cycles.
  let nowMs = $state(Date.now());
  $effect(() => {
    if (!marketOpenActive) return;
    const id = setInterval(() => (nowMs = Date.now()), 250);
    return () => clearInterval(id);
  });
  const secondsLeft = $derived(
    marketOpenActive
      ? Math.max(0, Math.ceil((marketOpen.endsAtMs - nowMs) / 1000))
      : 0
  );

  function fmt(v) {
    if (typeof v !== 'number') return '—';
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pctClass(p) {
    if (typeof p !== 'number' || p === 0) return '';
    return p > 0 ? 'up' : 'down';
  }
  function fmtPct(p) {
    if (typeof p !== 'number') return '—';
    return (p > 0 ? '+' : '') + p.toFixed(1) + '%';
  }
  function lastFlipPct(m) {
    return typeof m?.lastFlipPct === 'number' ? m.lastFlipPct : null;
  }
  function allTimePct(m) {
    const h = m?.history;
    if (!Array.isArray(h) || h.length < 2) return null;
    const first = h[0];
    const last = h[h.length - 1];
    if (first === 0) return null;
    return Math.round(((last - first) / first) * 1000) / 10;
  }

  function close() {
    if (locked) return;
    ui.showMarketMonitor = false;
  }

  function buy(sym) {
    const qty = qtyFor(sym);
    send({ type: 'buyStock', symbol: sym, qty });
  }
  function sell(sym) {
    const qty = qtyFor(sym);
    send({ type: 'sellStock', symbol: sym, qty });
  }
  function ownedOf(sym) {
    return me?.stockLots?.[sym] ?? 0;
  }
</script>

<div class="overlay" onclick={close}>
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <header>
      <h2>Market Monitor</h2>
      <span class="round-tag">Round {gs.stocks?.round ?? 0}</span>
      {#if !locked}
        <button class="close" onclick={close}>×</button>
      {/if}
    </header>

    {#if marketOpenActive}
      <div class="market-open-banner">
        <strong>Market Open</strong> — every stock draws one card per second.
        Closes in <span class="countdown">{secondsLeft}s</span>.
      </div>
    {/if}

    <p class="ink-mute small">
      Live snapshot of every stock. Each volatile deck mixes a fixed base distribution
      (32 cards, expected value 0%) with two wildcards picked at random on every
      reshuffle. Wildcard values are hidden — draw an Insider Tip chance card to reveal
      the current deck's wildcards privately.
    </p>

    <div class="grid">
      {#each STOCK_ORDER as sym (sym)}
        {@const m = market[sym]}
        {@const cat = STOCK_CATALOG[sym]}
        {@const isIndex = cat?.type === 'index'}
        <article class="stock" class:index={isIndex}>
          <header class="stock-head">
            <div>
              <strong>{cat?.name ?? sym}</strong>
              <span class="type">{cat?.type}</span>
            </div>
            <div class="price-block">
              <div class="price">${fmt(m?.price)}</div>
              <div class="deltas">
                <span class={pctClass(lastFlipPct(m))}>last {fmtPct(lastFlipPct(m))}</span>
                <span class={pctClass(allTimePct(m))}>all {fmtPct(allTimePct(m))}</span>
              </div>
            </div>
          </header>

          <StockChart history={m?.history ?? []} width={300} height={120} />

          <div class="trade-row">
            <button
              class="trade-btn buy"
              onclick={() => buy(sym)}
              disabled={!me || me.bankrupt}
            >Buy</button>
            <input
              class="qty"
              type="number"
              min="1"
              step="1"
              value={tradeQty[sym] ?? 1}
              oninput={(e) => (tradeQty[sym] = e.currentTarget.value)}
            />
            <button
              class="trade-btn sell"
              onclick={() => sell(sym)}
              disabled={!me || me.bankrupt || ownedOf(sym) <= 0}
            >Sell</button>
            <span class="owned">own {ownedOf(sym)}</span>
          </div>

          {#if !isIndex}
            {@const myReveal = revealed[sym]}
            <div class="deck-info">
              <div class="row">
                <span class="label">Deck</span>
                <span class="value">{m?.deckSize ?? 0} card{(m?.deckSize ?? 0) === 1 ? '' : 's'} left</span>
              </div>
              <div class="row">
                <span class="label">Wilds in deck</span>
                <span class="value wilds">
                  {m?.wildsRemaining ?? 0} / 2
                </span>
              </div>
              {#if Array.isArray(myReveal) && myReveal.length > 0}
                <div class="row">
                  <span class="label">Wild values <span class="tip-tag">tip</span></span>
                  <span class="value wild-list">
                    {#each myReveal as v, i (i)}
                      <span class="wild-pill" class:up={v > 0} class:down={v < 0}>
                        {v > 0 ? '+' : ''}{v}%
                      </span>
                    {/each}
                  </span>
                </div>
              {:else}
                <div class="row">
                  <span class="label">Wild values</span>
                  <span class="value hidden-wilds">hidden</span>
                </div>
              {/if}
            </div>
          {:else}
            <p class="index-note">Tracks the average price of the five volatile stocks.</p>
          {/if}
        </article>
      {/each}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 220;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: var(--panel);
    border: 2px solid var(--line, var(--accent));
    border-radius: 8px;
    padding: 1rem 1.2rem;
    width: 1000px;
    max-width: 96vw;
    max-height: 92vh;
    overflow-y: auto;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin-bottom: 0.4rem;
  }
  header h2 { margin: 0; flex: 1; }
  .round-tag {
    background: var(--accent);
    color: #fff;
    padding: 0.15rem 0.6rem;
    border-radius: 999px;
    font-size: 0.75rem;
    letter-spacing: 0.04em;
  }
  .close { font-size: 1.4rem; padding: 0 0.5rem; cursor: pointer; }
  .small { font-size: 0.78rem; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
    gap: 0.8rem;
    margin-top: 0.6rem;
  }
  .stock {
    background: var(--bg);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 0.6rem 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .stock.index { border-color: var(--accent); }
  .stock-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.5rem;
  }
  .stock-head strong { font-size: 1rem; }
  .stock-head .type {
    font-size: 0.65rem;
    color: var(--ink-mute);
    margin-left: 0.4rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .price-block { text-align: right; }
  .price { font-family: monospace; font-size: 1.1rem; font-weight: 600; }
  .deltas {
    display: flex;
    gap: 0.5rem;
    font-size: 0.72rem;
    justify-content: flex-end;
    margin-top: 0.1rem;
  }

  .deck-info {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin-top: 0.2rem;
    padding-top: 0.4rem;
    border-top: 1px dashed var(--panel-border);
    font-size: 0.78rem;
  }
  .deck-info .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.4rem;
  }
  .deck-info .label { color: var(--ink-mute); }
  .deck-info .value { font-family: monospace; }
  .deck-info .wilds { font-weight: 600; }
  .wild-list { display: inline-flex; gap: 0.25rem; flex-wrap: wrap; justify-content: flex-end; }
  .wild-pill {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    font-size: 0.7rem;
    font-family: monospace;
  }
  .wild-pill.up { color: var(--good, #2e7d32); border-color: var(--good, #2e7d32); }
  .wild-pill.down { color: var(--danger, #c62828); border-color: var(--danger, #c62828); }
  .hidden-wilds { color: var(--ink-mute); font-style: italic; }
  .tip-tag {
    display: inline-block;
    margin-left: 0.3rem;
    padding: 0 0.35rem;
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--accent);
    color: #fff;
    border-radius: 999px;
    vertical-align: middle;
  }
  .index-note { margin: 0; font-size: 0.75rem; color: var(--ink-mute); font-style: italic; }
  .up { color: var(--good, #2e7d32); }
  .down { color: var(--danger, #c62828); }

  .market-open-banner {
    margin-top: 0.4rem;
    padding: 0.45rem 0.7rem;
    background: var(--good, #2e7d32);
    color: #fff;
    border-radius: 6px;
    font-size: 0.85rem;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .market-open-banner .countdown {
    font-family: monospace;
    font-weight: 700;
  }

  .trade-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.2rem;
  }
  .trade-btn {
    padding: 0.25rem 0.6rem;
    font-size: 0.78rem;
    font-weight: 600;
    border-radius: 4px;
    border: 1px solid var(--panel-border);
    cursor: pointer;
  }
  .trade-btn.buy { background: var(--good, #2e7d32); color: #fff; border-color: var(--good, #2e7d32); }
  .trade-btn.sell { background: var(--danger, #c62828); color: #fff; border-color: var(--danger, #c62828); }
  .trade-btn[disabled] { opacity: 0.45; cursor: not-allowed; }
  .qty {
    width: 56px;
    padding: 0.2rem 0.3rem;
    font-family: monospace;
    font-size: 0.8rem;
    border: 1px solid var(--panel-border);
    border-radius: 4px;
    background: var(--panel);
    color: inherit;
  }
  .owned {
    margin-left: auto;
    font-size: 0.72rem;
    color: var(--ink-mute);
    font-family: monospace;
  }
</style>
