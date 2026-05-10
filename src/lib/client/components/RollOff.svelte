<script>
  import { send } from '$lib/client/socket.js';
  import { session } from '$lib/client/stores.svelte.js';

  let { state } = $props();

  const ro = $derived(state.rollOff ?? { contenders: [], rolls: {}, round: 1 });
  const contenders = $derived(ro.contenders ?? []);
  const round = $derived(ro.round ?? 1);
  const rolls = $derived(ro.rolls ?? {});

  const mySeat = $derived(session.seat);
  const isContender = $derived(contenders.includes(mySeat));
  const haveRolled = $derived(rolls[mySeat] != null);
  const allRolled = $derived(contenders.length > 0 && contenders.every((s) => rolls[s] != null));

  function nameOf(seatIdx) {
    return state.seats?.find((s) => s.seat === seatIdx)?.name ?? `Seat ${seatIdx}`;
  }

  function roll() {
    send({ type: 'rollForOrder' });
  }
</script>

<div class="rolloff">
  <h1>Rolling for Turn Order</h1>
  <p class="hint">
    {round === 1
      ? 'Each player rolls; highest goes first.'
      : `Tie at round ${round - 1}. Tied players re-roll.`}
  </p>

  <ul class="contenders">
    {#each contenders as seatIdx (seatIdx)}
      {@const r = rolls[seatIdx]}
      <li class:me={seatIdx === mySeat} class:waiting={!r}>
        <span class="piece" style:background={`var(--player-${seatIdx})`}>
          {nameOf(seatIdx).charAt(0).toUpperCase()}
        </span>
        <span class="name">{nameOf(seatIdx)}{seatIdx === mySeat ? ' (you)' : ''}</span>
        {#if r}
          <span class="roll">
            <span class="die">{r.d1}</span>
            <span class="die">{r.d2}</span>
            <span class="total">= {r.total}</span>
          </span>
        {:else}
          <span class="pending">waiting…</span>
        {/if}
      </li>
    {/each}
  </ul>

  <div class="actions">
    {#if isContender && !haveRolled}
      <button class="primary big" onclick={roll}>Roll the dice</button>
    {:else if isContender && haveRolled}
      <p class="waiting-text">Waiting for the other players to roll…</p>
    {:else if !isContender && contenders.length > 0}
      <p class="waiting-text">Tied players are re-rolling.</p>
    {/if}
    {#if allRolled}
      <p class="waiting-text">Resolving…</p>
    {/if}
  </div>
</div>

<style>
  .rolloff {
    max-width: 600px;
    margin: 4rem auto;
    padding: 2rem;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 10px;
  }
  h1 {
    font-family: 'Georgia', serif;
    color: var(--accent);
    text-align: center;
    margin-bottom: 0.4rem;
  }
  .hint {
    color: var(--ink-mute);
    text-align: center;
    margin-top: 0;
  }
  .contenders {
    list-style: none;
    padding: 0;
    margin: 1.5rem 0;
  }
  .contenders li {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.6rem;
    border-bottom: 1px solid var(--panel-border);
  }
  .contenders li.me { background: rgba(46, 125, 50, 0.07); }
  .piece {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    color: #fff;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
  }
  .name { font-weight: 500; flex: 1; }
  .roll {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-family: monospace;
  }
  .die {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 2px solid var(--ink, #000);
    border-radius: 4px;
    font-weight: bold;
  }
  .total { font-weight: bold; color: var(--accent); }
  .pending { color: var(--ink-mute); font-style: italic; }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    margin-top: 1.5rem;
    align-items: center;
  }
  .big { font-size: 1.1rem; padding: 0.75rem 1.5rem; }
  .waiting-text { color: var(--ink-mute); font-style: italic; }
</style>
