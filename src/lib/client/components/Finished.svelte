<script>
  let { state } = $props();
  const winner = $derived(state.winnerSeat != null ? state.seats[state.winnerSeat] : null);

  function backToHome() {
    location.href = '/';
  }
</script>

<div class="finished">
  <h1>Game Over</h1>
  {#if winner}
    <div class="winner">
      <div class="trophy">🏆</div>
      <p>The winner is</p>
      <h2>{winner.name}</h2>
      <p class="cash">${winner.cash.toLocaleString()}</p>
    </div>
  {:else}
    <p>No winner.</p>
  {/if}
  <button class="primary" onclick={backToHome}>Back to Lobby</button>
</div>

<style>
  .finished {
    max-width: 500px;
    margin: 6rem auto;
    padding: 2rem;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    text-align: center;
  }
  h1 {
    font-family: 'Georgia', serif;
    color: var(--accent);
  }
  .trophy {
    font-size: 5rem;
  }
  h2 {
    margin: 0.5rem 0;
    font-size: 2rem;
  }
  .cash {
    font-size: 1.2rem;
    color: var(--accent);
    font-weight: bold;
  }
</style>
