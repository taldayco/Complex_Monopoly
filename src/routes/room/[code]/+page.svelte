<script>
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { connect, send } from '$lib/client/socket.js';
  import { conn, session, game } from '$lib/client/stores.svelte.js';
  import { loadSession } from '$lib/client/localSession.js';
  import Lobby from '$lib/client/components/Lobby.svelte';
  import GameUI from '$lib/client/components/GameUI.svelte';
  import Finished from '$lib/client/components/Finished.svelte';

  // $app/state's page is a runes-reactive object — no $-prefix subscription
  // needed. Preferred over $app/stores in Svelte 5.
  const roomCode = $derived(page.params.code.toUpperCase());
  let noSession = $state(false);

  onMount(() => {
    // Check both sessionStorage (this tab) and localStorage (any prior tab)
    // for a saved identity in this room. If the session.roomCode in memory
    // is already set for this room (e.g. just came from createRoom/joinRoom
    // on the landing page), use that — saveSession may not have run yet.
    let s = loadSession(roomCode);
    if (!s && session.roomCode === roomCode && session.playerToken) {
      s = { roomCode, playerToken: session.playerToken, seat: session.seat };
    }
    if (!s) {
      // No identity for this room. The server has no way to recognize this
      // client — sitting on the page would just spin "Connecting…" forever.
      // Send them home so they can join.
      noSession = true;
      return;
    }
    session.roomCode = s.roomCode;
    session.playerToken = s.playerToken;
    session.seat = s.seat;
    connect();
    send({ type: 'auth', roomCode: s.roomCode, playerToken: s.playerToken });
  });

  // Expose for browser-console debugging: open DevTools, type
  //   __monopoly.game.state
  // to see the live state without poking at module internals.
  if (typeof window !== 'undefined') {
    window.__monopoly = { game, session, conn };
  }
</script>

{#if game.myError}
  <div class="error-toast">{game.myError}</div>
{/if}

{#if noSession}
  <div class="loading">
    <p>You're not in room <strong>{roomCode}</strong> on this browser.</p>
    <button class="primary" onclick={() => goto('/')}>Go to home to join</button>
  </div>
{:else if !game.state}
  <div class="loading">
    {#if conn.status === 'open'}
      Connecting to room {roomCode}…
    {:else}
      {conn.status === 'connecting' ? 'Connecting…' : 'Disconnected. Trying to reconnect…'}
    {/if}
  </div>
{:else if game.state.phase === 'lobby'}
  <Lobby state={game.state} />
{:else if game.state.phase === 'playing'}
  <GameUI state={game.state} />
{:else if game.state.phase === 'finished'}
  <Finished state={game.state} />
{/if}

<style>
  .loading {
    max-width: 540px;
    margin: 6rem auto;
    text-align: center;
    color: var(--ink-mute);
    font-size: 1.1rem;
  }
  .error-toast {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 1000;
    background: var(--danger);
    color: #fff;
    padding: 0.6rem 1rem;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  }
</style>
