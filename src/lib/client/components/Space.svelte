<script>
  let { space, state, edge } = $props();

  const prop = $derived(state.properties?.[space.index] ?? null);
  const owner = $derived(prop?.ownerSeat != null ? state.seats[prop.ownerSeat] : null);

  function colorVar(group) {
    return `var(--${group})`;
  }
</script>

<div class="space {edge} type-{space.type}" class:mortgaged={prop?.mortgaged}>
  {#if space.type === 'property'}
    <div class="color-bar" style:background={colorVar(space.colorGroup)}></div>
  {/if}

  <div class="content">
    {#if space.type === 'go'}
      <div class="big">GO</div>
      <div class="sub">Collect $200</div>
    {:else if space.type === 'jail'}
      <div class="sub">Jail</div>
      <div class="sub">Just Visiting</div>
    {:else if space.type === 'freeParking'}
      <div class="sub">Free Parking</div>
    {:else if space.type === 'goToJail'}
      <div class="sub">Go To Jail</div>
    {:else if space.type === 'tax'}
      <div class="name">{space.name}</div>
      <div class="price">Pay ${space.amount}</div>
    {:else if space.type === 'chance'}
      <div class="big">?</div>
      <div class="sub">Chance</div>
    {:else if space.type === 'communityChest'}
      <div class="sub">Community Chest</div>
    {:else if space.type === 'railroad'}
      <div class="name">{space.name}</div>
      <div class="price">${space.price}</div>
    {:else if space.type === 'utility'}
      <div class="name">{space.name}</div>
      <div class="price">${space.price}</div>
    {:else if space.type === 'property'}
      <div class="name">{space.name}</div>
      <div class="price">${space.price}</div>
    {/if}
  </div>

  {#if prop?.ownerSeat != null}
    <div class="owner-ribbon" style:background={`var(--player-${prop.ownerSeat})`}>
      {owner?.name?.charAt(0) ?? '?'}
    </div>
  {/if}

  {#if prop?.houses > 0 && prop.houses < 5}
    <div class="houses">
      {#each Array(prop.houses) as _, i}<span class="house"></span>{/each}
    </div>
  {:else if prop?.houses === 5}
    <div class="houses"><span class="hotel"></span></div>
  {/if}

  {#if prop?.mortgaged}
    <div class="mortgaged-tag">MORT</div>
  {/if}
</div>

<style>
  .space {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    font-size: 0.62rem;
    line-height: 1.1;
    padding: 2px;
  }
  .color-bar {
    height: 16%;
    border-bottom: 1px solid #000;
    flex-shrink: 0;
  }
  .space.left .color-bar { display: none; }
  .space.right .color-bar { display: none; }
  .space.top .color-bar { display: none; }
  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 2px;
  }
  .name { font-weight: 600; font-size: 0.62rem; }
  .price { color: var(--ink-mute); font-size: 0.6rem; }
  .sub { font-size: 0.65rem; }
  .big { font-size: 1.6rem; font-weight: bold; font-family: 'Georgia', serif; color: var(--accent); }
  .type-go { background: #ffd180; }
  .type-jail { background: #ffab91; }
  .type-freeParking { background: #ffe0b2; }
  .type-goToJail { background: #ef9a9a; }
  .type-chance { background: #fff3e0; }
  .type-communityChest { background: #e3f2fd; }
  .type-tax { background: #e0e0e0; }
  .owner-ribbon {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 14px;
    color: #fff;
    font-weight: bold;
    font-size: 0.6rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-top: 1px solid #000;
  }
  .houses {
    position: absolute;
    top: 18%;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    gap: 1px;
  }
  .house {
    width: 6px;
    height: 6px;
    background: #2e7d32;
    border: 1px solid #000;
  }
  .hotel {
    width: 12px;
    height: 8px;
    background: var(--danger);
    border: 1px solid #000;
  }
  .mortgaged {
    opacity: 0.55;
  }
  .mortgaged-tag {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-15deg);
    color: var(--danger);
    font-weight: bold;
    font-size: 0.7rem;
    pointer-events: none;
  }
</style>
