<script>
  import { send } from '$lib/client/socket.js';
  let { state, me } = $props();

  function rollForJail() { send({ type: 'rollForJail' }); }
  function payJailFine() { send({ type: 'payJailFine' }); }
  function useCard() { send({ type: 'useGetOutOfJail' }); }
</script>

<div class="overlay">
  <div class="modal">
    <h2>You're in Jail</h2>
    <p>Turn {me.jailTurns} of 3.</p>
    <p>Choose how to get out:</p>
    <div class="options">
      <button onclick={rollForJail}>Roll for doubles</button>
      <button onclick={payJailFine} disabled={me.cash < 50}>Pay $50</button>
      {#if me.getOutOfJailFreeChance || me.getOutOfJailFreeCommunity}
        <button class="primary" onclick={useCard}>Use Get Out of Jail Free card</button>
      {/if}
    </div>
    <p class="hint">If you fail to roll doubles by your third turn, you must pay $50.</p>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 150;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: var(--panel);
    border: 2px solid var(--line);
    border-radius: 8px;
    padding: 1.5rem;
    width: 400px;
    max-width: 90vw;
  }
  h2 { margin-top: 0; }
  .options {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .hint { color: var(--ink-mute); font-size: 0.85rem; margin-top: 1rem; }
</style>
