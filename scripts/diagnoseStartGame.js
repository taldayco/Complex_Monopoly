#!/usr/bin/env node
// End-to-end diagnostic for the deployed Worker. Builds, deploys, then opens
// two WebSocket clients (host + player B), runs createRoom → joinRoom →
// startGame, and reports whether each socket received a state frame with
// phase='playing'. Use to verify the deployed bundle handles the start-game
// flow correctly and to pinpoint exactly where the chain breaks.
//
// Usage:
//   node scripts/diagnoseStartGame.js                # build + deploy + test
//   node scripts/diagnoseStartGame.js --skip-build   # skip the npm run build step
//   node scripts/diagnoseStartGame.js --skip-deploy  # skip wrangler deploy
//   DEPLOY_URL=wss://… node scripts/diagnoseStartGame.js   # override the URL
//
// Defaults to the URL shown in the user's deployed UI:
//   wss://monopoly-board.thomasconrod.workers.dev/ws

import { spawnSync } from 'node:child_process';
import WebSocket from 'ws';

const args = new Set(process.argv.slice(2));
const DEPLOY_URL =
  process.env.DEPLOY_URL ?? 'wss://monopoly-board.thomasconrod.workers.dev/ws';

function run(cmd, argv) {
  const r = spawnSync(cmd, argv, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`${cmd} ${argv.join(' ')} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

if (!args.has('--skip-build')) {
  console.log('▸ Building…');
  run('npm', ['run', 'build']);
}

if (!args.has('--skip-deploy')) {
  console.log('▸ Deploying…');
  run('npx', ['wrangler', 'deploy']);
  // Give CF a beat to roll the new bundle out globally.
  console.log('  waiting 3s for deploy to settle…');
  await new Promise((r) => setTimeout(r, 3000));
}

console.log(`▸ Connecting two clients to ${DEPLOY_URL}\n`);

function open(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DEPLOY_URL);
    const timer = setTimeout(() => reject(new Error(`${label}: open timeout`)), 8000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function instrument(ws, label) {
  const inbox = [];
  let teardown = false;
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); }
    catch { msg = { raw: data.toString() }; }
    inbox.push(msg);
    if (!teardown) console.log(`◀ ${label}  ${summarize(msg)}`);
  });
  ws.on('close', (code, reason) => {
    if (teardown) return;
    console.log(`✗ ${label} CLOSED  code=${code} reason=${reason?.toString?.() || ''}`);
  });
  ws.on('error', (e) => {
    if (teardown) return;
    console.log(`✗ ${label} ERROR  ${e?.message ?? e}`);
  });
  // Lets the caller silence the close/error chatter during clean shutdown.
  return Object.assign(inbox, { silence: () => { teardown = true; } });
}

function summarize(m) {
  if (m.type === 'state') {
    const gs = m.gameState ?? {};
    return `state  phase=${gs.phase} seats=${gs.seats?.length} turn=${gs.turn?.seat}/${gs.turn?.phase}`;
  }
  if (m.type === 'welcome') {
    return `welcome  seat=${m.seat} room=${m.roomCode} phase=${m.gameState?.phase}`;
  }
  if (m.type === 'error') {
    return `error  code=${m.code} message=${m.message}`;
  }
  return JSON.stringify(m).slice(0, 160);
}

function send(ws, msg, label) {
  console.log(`▶ ${label}  ${JSON.stringify(msg)}`);
  ws.send(JSON.stringify(msg));
}

function wait(inbox, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const found = inbox.find(predicate);
    if (found) return resolve(found);
    const tick = setInterval(() => {
      const f = inbox.find(predicate);
      if (f) { clearInterval(tick); return resolve(f); }
      if (Date.now() - start > timeoutMs) {
        clearInterval(tick);
        reject(new Error(`Timeout after ${timeoutMs}ms`));
      }
    }, 50);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = true;
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) pass = false;
}

const host = await open('HOST');
const playerB = await open('B   ');
const hostInbox = instrument(host, 'HOST');
const bInbox = instrument(playerB, 'B   ');

try {
  // 1. Host creates room
  send(host, { type: 'createRoom', name: 'Host', tokenPiece: 'topHat' }, 'HOST');
  const welcome = await wait(hostInbox, (m) => m.type === 'welcome');
  const roomCode = welcome.roomCode;
  console.log(`  → roomCode=${roomCode}\n`);
  check('host received WELCOME', !!roomCode);

  // 2. Player B joins
  send(playerB, { type: 'joinRoom', roomCode, name: 'PlayerB', tokenPiece: 'thimble' }, 'B   ');
  const welcomeB = await wait(bInbox, (m) => m.type === 'welcome');
  check('player B received WELCOME', !!welcomeB.roomCode);

  // 3. Host should receive a STATE (broadcast on join) showing 2 seats
  try {
    await wait(hostInbox, (m) => m.type === 'state' && m.gameState?.seats?.length === 2, 3000);
    check('host received STATE with 2 seats after join', true);
  } catch (e) {
    check('host received STATE with 2 seats after join', false, e.message);
  }

  // Drain a beat
  await sleep(300);

  // 4. Host clicks Start Game
  console.log('\n--- clicking Start Game ---');
  const idxBeforeStart = hostInbox.length;
  const idxBeforeStartB = bInbox.length;
  send(host, { type: 'startGame' }, 'HOST');

  // 5. Both should receive STATE with phase='playing'
  try {
    await wait(hostInbox, (m) => m.type === 'state' && m.gameState?.phase === 'playing', 5000);
    check('host received STATE phase=playing within 5s', true);
  } catch (e) {
    check('host received STATE phase=playing within 5s', false, e.message);
    console.error('  Host inbox after startGame:');
    for (const m of hostInbox.slice(idxBeforeStart)) console.error('   ', summarize(m));
  }
  try {
    await wait(bInbox, (m) => m.type === 'state' && m.gameState?.phase === 'playing', 5000);
    check('player B received STATE phase=playing within 5s', true);
  } catch (e) {
    check('player B received STATE phase=playing within 5s', false, e.message);
    console.error('  Player B inbox after startGame:');
    for (const m of bInbox.slice(idxBeforeStartB)) console.error('   ', summarize(m));
  }

  // 6. Click again — should return ALREADY_STARTED. With the safety net,
  //    a fresh state should arrive too (so a stuck client recovers).
  console.log('\n--- clicking Start Game AGAIN (testing safety net) ---');
  const idxBeforeRepeat = hostInbox.length;
  send(host, { type: 'startGame' }, 'HOST');
  await sleep(800);
  const errAfter = hostInbox.slice(idxBeforeRepeat).find(
    (m) => m.type === 'error' && m.code === 'ALREADY_STARTED'
  );
  check('second click triggered ALREADY_STARTED', !!errAfter);
  const stateAfterErr = hostInbox.slice(idxBeforeRepeat).find(
    (m) => m.type === 'state' && m.gameState?.phase === 'playing'
  );
  check('safety-net STATE arrived after ALREADY_STARTED', !!stateAfterErr);

  console.log(`\n${pass ? '✓ ALL CHECKS PASSED' : '✗ FAILURES'}`);
} catch (e) {
  console.error('\nFATAL', e);
  pass = false;
} finally {
  hostInbox.silence();
  bInbox.silence();
  host.close();
  playerB.close();
  setTimeout(() => process.exit(pass ? 0 : 1), 200);
}
