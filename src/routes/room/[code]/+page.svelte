<script>
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { connect, send } from '$lib/client/socket.js';
  import { conn, session, game } from '$lib/client/stores.svelte.js';
  import { loadSession } from '$lib/client/localSession.js';
  import Lobby from '$lib/client/components/Lobby.svelte';
  import RollOff from '$lib/client/components/RollOff.svelte';
  import GameUI from '$lib/client/components/GameUI.svelte';
  import Finished from '$lib/client/components/Finished.svelte';

  // $app/state's page is a runes-reactive object — no $-prefix subscription
  // needed. Preferred over $app/stores in Svelte 5.
  const roomCode = $derived(page.params.code.toUpperCase());
  let noSession = $state(false);

  onMount(() => {
    let s = loadSession(roomCode);
    if (!s && session.roomCode === roomCode && session.playerToken) {
      s = { roomCode, playerToken: session.playerToken, seat: session.seat };
    }
    if (!s) {
      noSession = true;
      return;
    }
    session.roomCode = s.roomCode;
    session.playerToken = s.playerToken;
    session.seat = s.seat;
    // socket.connect()'s open handler reads session and sends auth, so we
    // don't queue a duplicate here. If the WS is already open (e.g. the
    // landing page just established it), it'll fire immediately because
    // connect() will detect that and we'll explicitly send.
    connect();
    if (typeof window !== 'undefined') {
      // Page-load case where the WS was opened before this mount: the open
      // handler already fired, so we need to explicitly send auth now.
      send({ type: 'auth', roomCode: s.roomCode, playerToken: s.playerToken });
    }
  });

  // Expose for browser-console debugging without clobbering an already-set
  // `debug = true` flag from socket.js's frame logger.
  if (typeof window !== 'undefined') {
    window.__monopoly = { ...(window.__monopoly ?? {}), game, session, conn };
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
{:else if game.state.phase === 'rollOff'}
  <RollOff state={game.state} />
{:else if game.state.phase === 'playing'}
  <GameUI state={game.state} />
{:else if game.state.phase === 'finished'}
  <Finished state={game.state} />
{:else}
  <div class="loading">Unknown phase: {game.state.phase}</div>
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
