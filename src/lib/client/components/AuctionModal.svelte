<script>
  import { BOARD } from '$lib/shared/board.js';
  import { send } from '$lib/client/socket.js';
  import { AUCTION_INCREMENT, AUCTION_DURATION_MS } from '$lib/shared/constants.js';
  import { onMount, onDestroy } from 'svelte';

  let { state: gs, auction, mySeat } = $props();

  const space = $derived(BOARD[auction.spaceIndex]);
  const me = $derived(gs.seats.find((s) => s.seat === mySeat));
  const minBid = $derived(Math.max(1, auction.currentBid + AUCTION_INCREMENT));
  const canParticipate = $derived(!!me && !me.bankrupt);
  const canAffordMin = $derived(!!me && me.cash >= minBid);
  const isHighBidder = $derived(auction.highBidder === mySeat);

  let now = $state(Date.now());
  let interval;
  onMount(() => {
    interval = setInterval(() => (now = Date.now()), 100);
  });
  onDestroy(() => clearInterval(interval));

  const remaining = $derived(Math.max(0, auction.endsAtMs - now));
  const seconds = $derived((remaining / 1000).toFixed(1));
  const pct = $derived(Math.min(100, (remaining / AUCTION_DURATION_MS) * 100));

  let bidAmount = $state(1);
  $effect(() => {
    if (bidAmount < minBid) bidAmount = minBid;
  });

  function clampedBid(raw) {
    const cash = me?.cash ?? 0;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (n < minBid) return null;
    if (n > cash) return null;
    return Math.floor(n);
  }

  function submitBid() {
    const amt = clampedBid(bidAmount);
    if (amt == null) return;
    send({ type: 'bid', amount: amt });
  }

  function quickBid(delta) {
    const amt = clampedBid(minBid + delta);
    if (amt == null) return;
    bidAmount = amt;
    send({ type: 'bid', amount: amt });
  }
</script>

<div class="overlay">
  <div class="modal">
    <h2>Auction · {space.name}</h2>
    <p class="meta">Listed price: ${space.price}</p>

    <div class="timer" class:warn={remaining < 3000}>
      <div class="bar"><div class="bar-fill" style:width={`${pct}%`}></div></div>
      <strong>{seconds}s</strong>
    </div>

    <div class="state">
      <div>High bid: <strong>${auction.currentBid}</strong></div>
      {#if auction.highBidder != null}
        <div>by <strong style:color={`var(--player-${auction.highBidder})`}>{gs.seats[auction.highBidder].name}</strong>{isHighBidder ? ' (you)' : ''}</div>
      {:else}
        <div class="ink-mute">no bids yet</div>
      {/if}
    </div>

    {#if canParticipate}
      <div class="bid-form">
        <input
          type="number"
          min={minBid}
          max={me.cash}
          step="1"
          bind:value={bidAmount}
          disabled={!canAffordMin}
        />
        <button class="primary" onclick={submitBid} disabled={!canAffordMin || bidAmount < minBid}>
          Bid ${bidAmount}
        </button>
      </div>
      {#if canAffordMin}
        <div class="quick">
          <button onclick={() => quickBid(0)}>Min ${minBid}</button>
          <button onclick={() => quickBid(10)} disabled={me.cash < minBid + 10}>+$10</button>
          <button onclick={() => quickBid(50)} disabled={me.cash < minBid + 50}>+$50</button>
          <button onclick={() => quickBid(100)} disabled={me.cash < minBid + 100}>+$100</button>
        </div>
      {:else}
        <p class="ink-mute small">You can't afford the minimum bid (${minBid}).</p>
      {/if}
    {:else}
      <p class="ink-mute">You can't participate in this auction.</p>
    {/if}

    <p class="hint">Auction ends in {seconds}s — every bid resets the clock to {AUCTION_DURATION_MS / 1000}s.</p>
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
    padding: 1.2rem;
    width: 420px;
    max-width: 90vw;
  }
  h2 { margin-top: 0; }
  .meta { color: var(--ink-mute); margin-top: 0; }
  .timer {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0.8rem 0 0.5rem;
  }
  .timer .bar {
    flex: 1;
    height: 10px;
    background: var(--bg);
    border: 1px solid var(--panel-border);
    border-radius: 999px;
    overflow: hidden;
  }
  .timer .bar-fill {
    height: 100%;
    background: var(--good, #2e7d32);
    transition: width 0.1s linear;
  }
  .timer.warn .bar-fill { background: var(--danger, #c62828); }
  .state {
    background: #fffde7;
    border: 1px solid var(--warn, #f9a825);
    padding: 0.6rem;
    border-radius: 4px;
    margin: 0.5rem 0;
  }
  .bid-form { display: flex; gap: 0.4rem; margin-top: 0.8rem; }
  .bid-form input { width: 110px; }
  .bid-form button { flex: 1; }
  .quick {
    display: flex;
    gap: 0.3rem;
    margin-top: 0.4rem;
    flex-wrap: wrap;
  }
  .quick button { flex: 1; font-size: 0.8rem; }
  .hint { color: var(--ink-mute); font-size: 0.8rem; margin: 0.6rem 0 0; }
  .small { font-size: 0.85rem; }
</style>
