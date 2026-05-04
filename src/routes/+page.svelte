<script>
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { connect, send } from '$lib/client/socket.js';
  import { conn, session, game } from '$lib/client/stores.svelte.js';
  import { listSessions, clearSession } from '$lib/client/localSession.js';
  import { TOKEN_PIECES } from '$lib/shared/constants.js';

  let mode = $state('home'); // 'home' | 'create' | 'join'
  let name = $state('');
  let tokenPiece = $state('topHat');
  let joinCode = $state('');
  let savedSessions = $state([]);

  onMount(() => {
    connect();
    savedSessions = listSessions();
  });

  // When the welcome handler sets session.roomCode, navigate to that room.
  $effect(() => {
    if (session.roomCode) goto(`/room/${session.roomCode}`);
  });

  function handleCreate() {
    if (!name.trim()) return;
    send({ type: 'createRoom', name: name.trim(), tokenPiece });
  }

  function handleJoin() {
    if (!name.trim() || !joinCode.trim()) return;
    send({
      type: 'joinRoom',
      roomCode: joinCode.trim().toUpperCase(),
      name: name.trim(),
      tokenPiece
    });
  }

  function rejoin(s) {
    session.roomCode = s.roomCode;
    session.playerToken = s.playerToken;
    session.seat = s.seat;
    goto(`/room/${s.roomCode}`);
  }

  function deleteRoom(roomCode) {
    clearSession(roomCode);
    savedSessions = listSessions();
  }
</script>

<div class="landing">
  <h1>Monopoly</h1>
  <p class="subtitle">2–8 players · classic US board</p>

  {#if game.myError}
    <div class="error-banner">{game.myError}</div>
  {/if}

  {#if mode === 'home'}
    <div class="actions">
      <button class="primary big" onclick={() => (mode = 'create')}>Create Room</button>
      <button class="big" onclick={() => (mode = 'join')}>Join Room</button>
    </div>

    {#if savedSessions.length > 0}
      <div class="saved">
        <h3>Recent rooms</h3>
        <ul>
          {#each savedSessions as s (s.roomCode)}
            <li>
              <button class="delete" onclick={() => deleteRoom(s.roomCode)}>Delete</button>
              <span class="code">{s.roomCode}</span>
              <button onclick={() => rejoin(s)}>Reconnect</button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {:else if mode === 'create'}
    <div class="form">
      <h2>New Room</h2>
      <label>Your name <input type="text" bind:value={name} maxlength="20" placeholder="Player" /></label>
      <label>
        Token piece
        <select bind:value={tokenPiece}>
          {#each TOKEN_PIECES as p}<option value={p}>{p}</option>{/each}
        </select>
      </label>
      <div class="row">
        <button onclick={() => (mode = 'home')}>Back</button>
        <button class="primary" onclick={handleCreate} disabled={!name.trim()}>Create</button>
      </div>
    </div>
  {:else if mode === 'join'}
    <div class="form">
      <h2>Join Room</h2>
      <label>Your name <input type="text" bind:value={name} maxlength="20" placeholder="Player" /></label>
      <label>
        Room code
        <input type="text" bind:value={joinCode} maxlength="6" placeholder="ABC123" style="text-transform:uppercase" />
      </label>
      <label>
        Preferred token piece
        <select bind:value={tokenPiece}>
          {#each TOKEN_PIECES as p}<option value={p}>{p}</option>{/each}
        </select>
      </label>
      <div class="row">
        <button onclick={() => (mode = 'home')}>Back</button>
        <button class="primary" onclick={handleJoin} disabled={!name.trim() || !joinCode.trim()}>Join</button>
      </div>
    </div>
  {/if}

  <div class="conn-status" class:closed={conn.status !== 'open'}>
    Connection: {conn.status}
  </div>
</div>

<style>
  .landing {
    max-width: 540px;
    margin: 4rem auto;
    padding: 2rem;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 10px;
  }
  h1 {
    font-family: 'Georgia', serif;
    font-size: 3rem;
    margin: 0;
    color: var(--accent);
    text-align: center;
  }
  .subtitle {
    text-align: center;
    color: var(--ink-mute);
    margin-top: 0;
  }
  .actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
    margin: 2rem 0;
  }
  .big {
    font-size: 1.1rem;
    padding: 0.75rem 1.5rem;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-top: 1.5rem;
  }
  .form label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-weight: 500;
  }
  .row {
    display: flex;
    gap: 0.6rem;
    justify-content: flex-end;
  }
  .saved {
    margin-top: 2rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--panel-border);
  }
  .saved h3 { margin-top: 0; }
  .saved ul { list-style: none; padding: 0; margin: 0; }
  .saved li { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; padding: 0.4rem 0; }
  .saved .code { font-family: monospace; font-size: 1.1rem; letter-spacing: 0.1em; flex: 1; }
  .saved .delete { background: var(--danger, #c0392b); color: #fff; border: none; }
  .error-banner {
    background: var(--danger);
    color: #fff;
    padding: 0.6rem 1rem;
    border-radius: 6px;
    margin-bottom: 1rem;
  }
  .conn-status {
    margin-top: 2rem;
    text-align: center;
    color: var(--good);
    font-size: 0.85rem;
  }
  .conn-status.closed { color: var(--warn); }
</style>
