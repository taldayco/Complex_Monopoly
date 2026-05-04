<script>
  import { send } from '$lib/client/socket.js';

  let { state: gs, mySeat } = $props();

  const me = $derived(gs.seats.find((s) => s.seat === mySeat));
  const otherSeats = $derived(
    gs.seats.filter((s) => s.seat !== mySeat && !s.bankrupt)
  );

  let toSeat = $state(otherSeats[0]?.seat ?? null);
  let amount = $state(50);

  // Keep toSeat valid as the seat list updates.
  $effect(() => {
    if (otherSeats.length === 0) {
      toSeat = null;
      return;
    }
    if (!otherSeats.some((s) => s.seat === toSeat)) {
      toSeat = otherSeats[0].seat;
    }
  });

  function fmt(v) {
    if (typeof v !== 'number') return '—';
    return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function wire() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || toSeat == null) return;
    send({ type: 'wireTransfer', toSeat, amount: amt });
    amount = 50;
  }

  const targetSeat = $derived(otherSeats.find((s) => s.seat === toSeat));
  const canWire = $derived(
    me &&
      targetSeat &&
      Number(amount) > 0 &&
      Number(amount) <= (me.cash ?? 0)
  );
</script>

<div class="wire">
  <section>
    <h3>Send cash</h3>
    <p class="ink-mute small">
      Wire money instantly to another player. The transfer goes through with no approval.
    </p>
    {#if otherSeats.length === 0}
      <p class="empty">No other active players.</p>
    {:else}
      <div class="form">
        <label>
          To
          <select bind:value={toSeat}>
            {#each otherSeats as s (s.seat)}
              <option value={s.seat}>{s.name} — ${fmt(s.cash)}</option>
            {/each}
          </select>
        </label>
        <label>
          Amount
          <input type="number" min="1" step="1" bind:value={amount} />
        </label>
        <button class="primary" onclick={wire} disabled={!canWire}>
          Send ${fmt(Number(amount) || 0)}
        </button>
      </div>
      <p class="balance">Your cash: <strong>${fmt(me?.cash)}</strong></p>
    {/if}
  </section>
</div>

<style>
  .wire { display: flex; flex-direction: column; gap: 1rem; }
  section { padding: 0.6rem 0.8rem; background: var(--bg); border: 1px solid var(--panel-border); border-radius: 6px; }
  section h3 { margin: 0 0 0.4rem; font-size: 0.95rem; }
  .form { display: grid; grid-template-columns: 2fr 1fr auto; gap: 0.6rem; align-items: end; }
  .form label { display: flex; flex-direction: column; font-size: 0.78rem; gap: 0.2rem; }
  .form input, .form select { padding: 0.3rem; }
  .balance { margin: 0.4rem 0 0; font-size: 0.85rem; color: var(--ink-mute); }
  .empty { color: var(--ink-mute); font-style: italic; margin: 0.4rem 0; font-size: 0.85rem; }
  .small { font-size: 0.78rem; }
</style>
