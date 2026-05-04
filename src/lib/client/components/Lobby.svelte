<script>
  import { send } from '$lib/client/socket.js';
  import { session } from '$lib/client/stores.svelte.js';
  import { MIN_PLAYERS, MAX_PLAYERS } from '$lib/shared/constants.js';

  let { state } = $props();

  const isHost = $derived(state.hostSeat === session.seat);
  const canStart = $derived(state.seats.length >= MIN_PLAYERS);

  function start() {
    send({ type: 'startGame' });
  }

  function leave() {
    send({ type: 'leaveRoom' });
    location.href = '/';
  }
</script>

<div class="lobby">
  <h1>Room <span class="code">{state.code}</span></h1>
  <p class="hint">Share this code with players to join.</p>

  <div class="seats">
    <h3>Players ({state.seats.length}/{MAX_PLAYERS})</h3>
    <ul>
      {#each state.seats as s (s.seat)}
        <li class:host={s.seat === state.hostSeat} class:me={s.seat === session.seat}>
          <span class="piece" style:background={`var(--player-${s.seat})`}>
            {s.name.charAt(0).toUpperCase()}
          </span>
          <span class="name">{s.name}{s.seat === session.seat ? ' (you)' : ''}</span>
          <span class="token">{s.tokenPiece}</span>
          {#if s.seat === state.hostSeat}<span class="badge">Host</span>{/if}
        </li>
      {/each}
    </ul>
  </div>

  <div class="actions">
    {#if isHost}
      <button class="primary big" onclick={start} disabled={!canStart}>
        {canStart ? 'Start Game' : `Need ${MIN_PLAYERS - state.seats.length} more player${MIN_PLAYERS - state.seats.length === 1 ? '' : 's'}`}
      </button>
    {:else}
      <p class="waiting">Waiting for host to start the game…</p>
    {/if}
    <button onclick={leave}>Leave Room</button>
  </div>
</div>

<style>
  .lobby {
    max-width: 600px;
    margin: 4rem auto;
    padding: 2rem;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 10px;
  }
  h1 { font-family: 'Georgia', serif; color: var(--accent); text-align: center; }
  .code {
    font-family: monospace;
    letter-spacing: 0.15em;
    background: var(--bg);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
  }
  .hint { color: var(--ink-mute); text-align: center; }
  .seats { margin-top: 2rem; }
  .seats ul { list-style: none; padding: 0; margin: 0; }
  .seats li {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.6rem;
    border-bottom: 1px solid var(--panel-border);
  }
  .seats li.me { background: rgba(46, 125, 50, 0.07); }
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
    box-shadow: 0 0 0 1px rgba(0,0,0,0.3);
  }
  .name { font-weight: 500; flex: 1; }
  .token { color: var(--ink-mute); font-size: 0.9rem; }
  .badge {
    background: var(--accent);
    color: #fff;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    margin-top: 2rem;
    align-items: center;
  }
  .big { font-size: 1.1rem; padding: 0.75rem 1.5rem; }
  .waiting { color: var(--ink-mute); font-style: italic; }
</style>
