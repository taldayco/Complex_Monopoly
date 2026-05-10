<script>
  import { send } from '$lib/client/socket.js';
  import { BOARD } from '$lib/shared/board.js';
  import { ui } from '$lib/client/stores.svelte.js';

  let { state: gs, mode, mySeat, target = null, trade = null } = $props();

  const me = $derived(gs.seats[mySeat]);
  const partnerSeat = $derived(mode === 'respond' ? trade.fromSeat : target);
  const partner = $derived(gs.seats[partnerSeat]);

  let offerCash = $state(0);
  let requestCash = $state(0);
  let offerProps = $state([]);
  let requestProps = $state([]);
  let offerJailC = $state(false);
  let offerJailCC = $state(false);
  let requestJailC = $state(false);
  let requestJailCC = $state(false);

  const myProps = $derived(
    Object.entries(gs.properties)
      .filter(([, p]) => p.ownerSeat === mySeat && p.houses === 0)
      .map(([i]) => Number(i))
  );
  const theirProps = $derived(
    Object.entries(gs.properties)
      .filter(([, p]) => p.ownerSeat === partnerSeat && p.houses === 0)
      .map(([i]) => Number(i))
  );

  function toggle(arr, val) {
    const i = arr.indexOf(val);
    if (i === -1) return [...arr, val];
    const copy = arr.slice();
    copy.splice(i, 1);
    return copy;
  }

  function cancel() {
    if (mode === 'propose') {
      ui.showTrade = false;
      ui.tradeTarget = null;
    } else {
      send({ type: 'respondTrade', accept: false });
    }
  }

  function safeCash(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function propose() {
    send({
      type: 'proposeTrade',
      toSeat: partnerSeat,
      offer: {
        cash: safeCash(offerCash),
        properties: offerProps,
        jailFreeChance: offerJailC,
        jailFreeCommunity: offerJailCC
      },
      request: {
        cash: safeCash(requestCash),
        properties: requestProps,
        jailFreeChance: requestJailC,
        jailFreeCommunity: requestJailCC
      }
    });
    ui.showTrade = false;
    ui.tradeTarget = null;
  }

  function accept() {
    send({ type: 'respondTrade', accept: true });
  }

  // For respond mode, populate fields from incoming trade.
  $effect(() => {
    if (mode === 'respond' && trade) {
      offerCash = trade.offer.cash ?? 0;
      requestCash = trade.request.cash ?? 0;
      offerProps = trade.offer.properties ?? [];
      requestProps = trade.request.properties ?? [];
      offerJailC = trade.offer.jailFreeChance ?? false;
      offerJailCC = trade.offer.jailFreeCommunity ?? false;
      requestJailC = trade.request.jailFreeChance ?? false;
      requestJailCC = trade.request.jailFreeCommunity ?? false;
    }
  });
</script>

<div class="overlay">
  <div class="modal">
    <h2>{mode === 'propose' ? 'Propose Trade' : 'Trade Offer From ' + partner.name}</h2>

    <div class="sides">
      <div class="side">
        <h4>{mode === 'propose' ? 'You give' : `${partner.name} gives`}</h4>
        <label>Cash <input type="number" min="0" max={mode === 'propose' ? me.cash : partner.cash} bind:value={offerCash} disabled={mode === 'respond'} /></label>
        <div class="prop-list">
          {#each (mode === 'propose' ? myProps : theirProps) as i}
            {@const sp = BOARD[i]}
            <label class="prop-check">
              <input
                type="checkbox"
                checked={offerProps.includes(i)}
                onchange={() => offerProps = toggle(offerProps, i)}
                disabled={mode === 'respond'}
              />
              <span class="dot" style:background={sp.colorGroup ? `var(--${sp.colorGroup})` : 'var(--rail)'}></span>
              {sp.name}
            </label>
          {/each}
        </div>
        <label class="prop-check">
          <input type="checkbox" bind:checked={offerJailC} disabled={mode === 'respond'} /> Chance Jail-Free Card
        </label>
        <label class="prop-check">
          <input type="checkbox" bind:checked={offerJailCC} disabled={mode === 'respond'} /> CC Jail-Free Card
        </label>
      </div>

      <div class="side">
        <h4>{mode === 'propose' ? `${partner.name} gives` : 'You give'}</h4>
        <label>Cash <input type="number" min="0" max={mode === 'propose' ? partner.cash : me.cash} bind:value={requestCash} disabled={mode === 'respond'} /></label>
        <div class="prop-list">
          {#each (mode === 'propose' ? theirProps : myProps) as i}
            {@const sp = BOARD[i]}
            <label class="prop-check">
              <input
                type="checkbox"
                checked={requestProps.includes(i)}
                onchange={() => requestProps = toggle(requestProps, i)}
                disabled={mode === 'respond'}
              />
              <span class="dot" style:background={sp.colorGroup ? `var(--${sp.colorGroup})` : 'var(--rail)'}></span>
              {sp.name}
            </label>
          {/each}
        </div>
        <label class="prop-check">
          <input type="checkbox" bind:checked={requestJailC} disabled={mode === 'respond'} /> Chance Jail-Free Card
        </label>
        <label class="prop-check">
          <input type="checkbox" bind:checked={requestJailCC} disabled={mode === 'respond'} /> CC Jail-Free Card
        </label>
      </div>
    </div>

    <div class="actions">
      <button onclick={cancel}>{mode === 'respond' ? 'Decline' : 'Cancel'}</button>
      {#if mode === 'propose'}
        <button class="primary" onclick={propose}>Propose</button>
      {:else}
        <button class="primary" onclick={accept}>Accept</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 170;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: var(--panel);
    border: 2px solid var(--line);
    border-radius: 8px;
    padding: 1.2rem;
    width: 720px;
    max-width: 95vw;
    max-height: 80vh;
    overflow-y: auto;
  }
  h2 { margin-top: 0; }
  .sides {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  .side {
    background: #fff;
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 0.8rem;
  }
  .side h4 { margin-top: 0; }
  .side label { display: flex; align-items: center; gap: 0.4rem; margin: 0.3rem 0; }
  .side input[type="number"] { width: 100px; }
  .prop-list {
    max-height: 220px;
    overflow-y: auto;
    margin: 0.5rem 0;
    border-top: 1px dotted var(--panel-border);
    border-bottom: 1px dotted var(--panel-border);
    padding: 0.3rem 0;
  }
  .prop-check { font-size: 0.85rem; }
  .dot { width: 10px; height: 10px; border: 1px solid #000; flex-shrink: 0; }
  .actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 1rem;
  }
</style>
