<script>
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { connect, send } from '$lib/client/socket.js';
  import { conn, session, game } from '$lib/client/stores.svelte.js';
  import { loadSession } from '$lib/client/localSession.js';
  import Lobby from '$lib/client/components/Lobby.svelte';
  import GameUI from '$lib/client/components/GameUI.svelte';
  import Finished from '$lib/client/components/Finished.svelte';

  const roomCode = $derived($page.params.code.toUpperCase());

  onMount(() => {
    const s = loadSession(roomCode);
    if (s) {
      session.roomCode = s.roomCode;
      session.playerToken = s.playerToken;
      session.seat = s.seat;
    }
    connect();
    if (s) {
      send({ type: 'auth', roomCode: s.roomCode, playerToken: s.playerToken });
    }
  });
</script>

{#if game.myError}
  <div class="error-toast">{game.myError}</div>
{/if}

{#if !game.state}
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
