<script>
  import { send } from '$lib/client/socket.js';

  let { state: gs, mySeat } = $props();

  const me = $derived(gs.seats.find((s) => s.seat === mySeat));
  const allTransfers = $derived(Array.isArray(gs.pendingTransfers) ? gs.pendingTransfers : []);
  const incoming = $derived(allTransfers.filter((t) => t.toSeat === mySeat));
  const outgoing = $derived(allTransfers.filter((t) => t.fromSeat === mySeat));
  const otherSeats = $derived(
    gs.seats.filter((s) => s.seat !== mySeat && !s.bankrupt)
  );

  let toSeat = $state(otherSeats[0]?.seat ?? null);
  let amount = $state(50);
  let note = $state('');

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

  function nameOf(seat) {
    return gs.seats.find((s) => s.seat === seat)?.name ?? `Seat ${seat}`;
  }

  function submitRequest() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || toSeat == null) return;
    send({ type: 'requestTransfer', toSeat, amount: amt, note });
    amount = 50;
    note = '';
  }
  function approve(id) { send({ type: 'respondTransfer', requestId: id, approve: true }); }
  function deny(id) { send({ type: 'respondTransfer', requestId: id, approve: false }); }
  function cancel(id) { send({ type: 'cancelTransfer', requestId: id }); }

  const canRequest = $derived(toSeat != null && Number(amount) > 0);
</script>

<div class="requests">
  <section class="incoming">
    <h3>Incoming requests <span class="count">{incoming.length}</span></h3>
    {#if incoming.length === 0}
      <p class="empty">No pending requests for you.</p>
    {:else}
      <ul>
        {#each incoming as r (r.id)}
          <li>
            <div class="head">
              <strong>{nameOf(r.fromSeat)}</strong> requests <strong>${fmt(r.amount)}</strong>
            </div>
            {#if r.note}<p class="note">"{r.note}"</p>{/if}
            <div class="actions">
              <button
                class="primary"
                onclick={() => approve(r.id)}
                disabled={(me?.cash ?? 0) < r.amount}
              >Approve</button>
              <button onclick={() => deny(r.id)}>Deny</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="outgoing">
    <h3>Your outgoing requests</h3>
    {#if outgoing.length === 0}
      <p class="empty">No outgoing requests.</p>
    {:else}
      <ul>
        {#each outgoing as r (r.id)}
          <li>
            <div class="head">
              To <strong>{nameOf(r.toSeat)}</strong> · <strong>${fmt(r.amount)}</strong>
            </div>
            {#if r.note}<p class="note">"{r.note}"</p>{/if}
            <button onclick={() => cancel(r.id)}>Cancel</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="new">
    <h3>Request money</h3>
    {#if otherSeats.length === 0}
      <p class="empty">No other active players.</p>
    {:else}
      <div class="form">
        <label>
          From
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
        <label class="full">
          Note (optional)
          <input type="text" maxlength="80" bind:value={note} placeholder="Why?" />
        </label>
        <button class="primary" onclick={submitRequest} disabled={!canRequest}>
          Request
        </button>
      </div>
    {/if}
  </section>
</div>

<style>
  .requests { display: flex; flex-direction: column; gap: 1rem; }
  section { padding: 0.6rem 0.8rem; background: var(--bg); border: 1px solid var(--panel-border); border-radius: 6px; }
  section h3 { margin: 0 0 0.4rem; font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem; }
  .count {
    background: var(--accent);
    color: #fff;
    font-size: 0.7rem;
    padding: 0 0.4rem;
    border-radius: 999px;
  }
  ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  li {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 0.5rem 0.6rem;
  }
  .incoming li { border-color: var(--warn, #ed6c02); }
  .head { font-size: 0.9rem; }
  .note { margin: 0.3rem 0; font-size: 0.8rem; color: var(--ink-mute); font-style: italic; }
  .actions { display: flex; gap: 0.4rem; margin-top: 0.4rem; }
  .actions button { font-size: 0.78rem; }
  .empty { color: var(--ink-mute); font-style: italic; margin: 0.4rem 0; font-size: 0.85rem; }

  .new .form {
    display: grid;
    grid-template-columns: 2fr 1fr auto;
    gap: 0.6rem;
    align-items: end;
  }
  .new .form label { display: flex; flex-direction: column; font-size: 0.78rem; gap: 0.2rem; }
  .new .form .full { grid-column: 1 / -1; }
  .new .form input, .new .form select { padding: 0.3rem; }
</style>
