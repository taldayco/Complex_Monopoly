<script>
  import { BOARD } from '$lib/shared/board.js';
  import { RAILROAD_RENT, UTILITY_MULT } from '$lib/shared/constants.js';

  let { spaceIndex, state, onClose } = $props();
  const space = $derived(BOARD[spaceIndex]);
  const prop = $derived(state.properties?.[spaceIndex]);
  const owner = $derived(prop?.ownerSeat != null ? state.seats[prop.ownerSeat] : null);
</script>

<div class="overlay" onclick={onClose} role="presentation">
  <div class="card" onclick={(e) => e.stopPropagation()} role="dialog">
    {#if space.colorGroup}
      <div class="color" style:background={`var(--${space.colorGroup})`}>
        TITLE DEED
      </div>
    {/if}
    <h2>{space.name}</h2>

    {#if space.type === 'property'}
      <table><tbody>
        <tr><td>Rent</td><td>${space.rent[0]}</td></tr>
        <tr><td>With color set</td><td>${space.rent[0] * 2}</td></tr>
        <tr><td>With 1 House</td><td>${space.rent[1]}</td></tr>
        <tr><td>With 2 Houses</td><td>${space.rent[2]}</td></tr>
        <tr><td>With 3 Houses</td><td>${space.rent[3]}</td></tr>
        <tr><td>With 4 Houses</td><td>${space.rent[4]}</td></tr>
        <tr><td>With Hotel</td><td>${space.rent[5]}</td></tr>
        <tr><td>House Cost</td><td>${space.houseCost} ea</td></tr>
        <tr><td>Mortgage</td><td>${space.mortgageValue}</td></tr>
        <tr><td>Price</td><td>${space.price}</td></tr>
      </tbody></table>
    {:else if space.type === 'railroad'}
      <table><tbody>
        {#each RAILROAD_RENT as r, i}
          <tr><td>Rent ({i + 1} owned)</td><td>${r}</td></tr>
        {/each}
        <tr><td>Mortgage</td><td>${space.mortgageValue}</td></tr>
        <tr><td>Price</td><td>${space.price}</td></tr>
      </tbody></table>
    {:else if space.type === 'utility'}
      <table><tbody>
        <tr><td>1 utility</td><td>{UTILITY_MULT[0]}× dice</td></tr>
        <tr><td>2 utilities</td><td>{UTILITY_MULT[1]}× dice</td></tr>
        <tr><td>Mortgage</td><td>${space.mortgageValue}</td></tr>
        <tr><td>Price</td><td>${space.price}</td></tr>
      </tbody></table>
    {:else if space.type === 'marketOpen'}
      <p>Landing here opens the market for 34 seconds. Every volatile stock draws one card per second; all players can buy and sell from the Market Monitor.</p>
    {:else}
      <p class="type-desc">{space.type}</p>
    {/if}

    {#if owner}
      <div class="owner-info">
        Owned by <strong>{owner.name}</strong>
        {#if prop.mortgaged}<span class="m-tag">MORTGAGED</span>{/if}
        {#if prop.houses > 0 && prop.houses < 5}· {prop.houses} houses{/if}
        {#if prop.houses === 5}· Hotel{/if}
      </div>
    {:else if space.type === 'property' || space.type === 'railroad' || space.type === 'utility'}
      <div class="owner-info">Unowned</div>
    {/if}

    <button onclick={onClose}>Close</button>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 230;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .card {
    background: #fffaeb;
    border: 2px solid #000;
    border-radius: 8px;
    padding: 1.2rem;
    width: 320px;
    max-width: 90vw;
    box-shadow: 0 6px 24px rgba(0,0,0,0.3);
  }
  .color {
    background: var(--lightblue);
    text-align: center;
    color: #000;
    font-weight: bold;
    padding: 0.3rem;
    border: 1px solid #000;
    margin: -0.6rem -0.6rem 0.6rem -0.6rem;
  }
  h2 {
    text-align: center;
    margin: 0.4rem 0 0.8rem 0;
    font-family: 'Georgia', serif;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    margin-bottom: 0.8rem;
  }
  td {
    padding: 0.2rem 0.4rem;
    border-bottom: 1px dotted #aaa;
  }
  td:last-child { text-align: right; font-weight: 600; }
  .owner-info {
    background: var(--bg);
    padding: 0.4rem;
    border-radius: 4px;
    text-align: center;
    margin-bottom: 0.8rem;
    font-size: 0.85rem;
  }
  .m-tag { color: var(--danger); font-weight: bold; margin-left: 0.4rem; }
  button { width: 100%; }
  .type-desc { text-transform: capitalize; text-align: center; color: var(--ink-mute); }
</style>
