<script>
  let { state } = $props();
  const roll = $derived(state.turn?.lastRoll);
</script>

<div class="dice">
  {#if roll}
    <div class="die">{roll[0]}</div>
    <div class="die">{roll[1]}</div>
  {:else}
    <div class="die empty">·</div>
    <div class="die empty">·</div>
  {/if}
</div>

<style>
  .dice {
    display: flex;
    gap: 0.6rem;
  }
  .die {
    width: 48px;
    height: 48px;
    background: #fff;
    border: 2px solid #000;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.6rem;
    font-weight: bold;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  }
  .die.empty {
    color: var(--ink-mute);
    opacity: 0.5;
  }
</style>
