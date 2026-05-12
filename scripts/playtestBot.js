#!/usr/bin/env node

import WebSocket from 'ws';

const DEPLOY_URL = process.env.DEPLOY_URL ?? 'wss://monopoly-board.thomasconrod.workers.dev/ws';
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 40);
const HARD_DEADLINE_MS = Number(process.env.HARD_DEADLINE_MS ?? 180_000);
const TICK_BUDGET_MS = Number(process.env.TICK_BUDGET_MS ?? 90_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DEPLOY_URL);
    const t = setTimeout(() => reject(new Error(label + ' open timeout')), 8000);
    ws.once('open', () => { clearTimeout(t); resolve(ws); });
    ws.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

function summarizeLog(entry) {
  const seat = entry.seat == null ? '—' : `s${entry.seat}`;
  const p = entry.payload ?? {};
  switch (entry.type) {
    case 'economyFlip':
      return `[${seat}] economyFlip  inf=${p.inflationFactor?.toFixed?.(4)}  rate=${p.reserveRate?.toFixed?.(4)}  policyDelta=${p.policyDelta}  card.inf=${p.card?.inf}${p.intIgnored ? '  (intIgnored)' : ''}${p.reshuffled ? '  (reshuffled)' : ''}`;
    case 'inflationErosion':
      return `[${seat}] inflationErosion  delta=${p.delta?.toFixed?.(6)}  totalEroded=$${p.totalEroded?.toFixed?.(2)}  ${JSON.stringify(p.breakdown)}`;
    case 'passGo':
      return `[${seat}] passGo  +$${p.amount?.toFixed?.(2)}`;
    case 'buy':
      return `[${seat}] buy  spaceIndex=${p.spaceIndex} price=$${p.price?.toFixed?.(2)}`;
    case 'rentDue':
      return `[${seat}] rentDue  $${p.amount?.toFixed?.(2)} → s${p.creditor}`;
    case 'rollDice':
      return `[${seat}] rollDice  ${p.d1}+${p.d2}${p.doubles ? ' doubles' : ''}`;
    case 'auctionStart':
      return `[${seat}] auctionStart  spaceIndex=${p.spaceIndex} startPrice=$${p.startPrice}`;
    case 'auctionEnd':
      return `[${seat}] auctionEnd  spaceIndex=${p.spaceIndex} soldTo=s${p.soldTo} price=$${p.price}${p.randomized ? ' (randomized)' : ''}`;
    case 'toJail':
      return `[${seat}] toJail`;
    case 'bankrupt':
      return `[${seat}] BANKRUPT  creditor=${p.creditorSeat == null ? 'bank' : 's' + p.creditorSeat}`;
    case 'gameOver':
      return `[${seat}] GAME OVER  winner=s${p.winnerSeat}`;
    case 'hysaInterest':
      return `[${seat}] hysaInterest  +$${p.amount?.toFixed?.(2) ?? p.interest?.toFixed?.(2)}`;
    default:
      return null;
  }
}

const interesting = new Set([
  'economyFlip', 'inflationErosion', 'passGo', 'buy', 'auctionEnd',
  'toJail', 'bankrupt', 'gameOver', 'rentDue'
]);

class Bot {
  constructor(label, ws, name, tokenPiece) {
    this.label = label;
    this.ws = ws;
    this.name = name;
    this.tokenPiece = tokenPiece;
    this.seat = null;
    this.playerToken = null;
    this.roomCode = null;
    this.lastLogLength = 0;
    this.gameState = null;
    this.lastSentSig = null;
    this.lastSentAt = 0;
    this.errors = [];
    ws.on('message', (data) => this.onMessage(JSON.parse(data.toString())));
  }

  onMessage(msg) {
    if (msg.type === 'welcome') {
      this.seat = msg.seat;
      this.playerToken = msg.playerToken;
      this.roomCode = msg.roomCode;
      this.gameState = msg.gameState;
      this.resolveSeat();
      this.drainLog();
      console.log(`◀ ${this.label} welcome seat=${this.seat} room=${this.roomCode}`);
      this.maybeAct();
    } else if (msg.type === 'state') {
      this.gameState = msg.gameState;
      this.resolveSeat();
      this.drainLog();
      this.maybeAct();
    } else if (msg.type === 'error') {
      this.errors.push(msg);
      if (
        msg.code !== 'NOT_YOUR_TURN' &&
        msg.code !== 'BAD_PHASE' &&
        msg.code !== 'BLOCKED_BY_PENDING' &&
        msg.code !== 'MARKET_OPEN_ACTIVE'
      ) {
        console.log(`◀ ${this.label} ERROR ${msg.code}  ${msg.message ?? ''}`);
      }
    }
  }

  resolveSeat() {
    const seats = this.gameState?.seats ?? [];
    const mine = seats.find((s) => s.name === this.name);
    if (mine && mine.seat !== this.seat) {
      console.log(`  ${this.label} seat reassigned ${this.seat} → ${mine.seat}`);
      this.seat = mine.seat;
    }
  }

  drainLog() {
    const log = this.gameState?.log ?? [];
    for (let i = this.lastLogLength; i < log.length; i++) {
      const e = log[i];
      if (interesting.has(e.type)) {
        const line = summarizeLog(e);
        if (line && this.label === 'A') console.log('  ' + line);
      }
    }
    this.lastLogLength = log.length;
  }

  send(action) {
    const sig = JSON.stringify(action);
    const now = Date.now();
    if (sig === this.lastSentSig && now - this.lastSentAt < 2000) return;
    this.lastSentSig = sig;
    this.lastSentAt = now;
    send(this.ws, action);
  }

  maybeAct() {
    const gs = this.gameState;
    if (!gs) return;
    if (gs.marketOpen?.active) return;
    const phaseSig = `${gs.phase}/${gs.turn?.phase}/${gs.turn?.seat}`;
    if (this.label === 'A' && phaseSig !== this._lastPhaseSig) {
      this._lastPhaseSig = phaseSig;
      console.log(`  [phase] ${phaseSig}  pa=${gs.pendingAction?.type ?? '-'}  myseat=${this.seat}`);
    }

    if (gs.phase === 'rollOff') {
      const ro = gs.rollOff;
      if (ro?.contenders?.includes(this.seat) && !ro.rolls?.[this.seat]) {
        this.send({ type: 'rollForOrder', seat: this.seat });
      }
      return;
    }
    if (gs.phase !== 'playing') return;

    const mySeat = gs.seats[this.seat];
    if (!mySeat || mySeat.bankrupt) return;

    if (mySeat.pendingLoanOffer) {
      this.send({ type: 'respondLoanOffer', seat: this.seat, decline: true });
      return;
    }
    if (gs.pendingTrade && gs.pendingTrade.toSeat === this.seat) {
      this.send({ type: 'respondTrade', seat: this.seat, accept: false });
      return;
    }
    if (gs.pendingTrainTravel && gs.pendingTrainTravel.seat === this.seat) {
      this.send({ type: 'skipTrainTravel', seat: this.seat });
      return;
    }
    if (gs.pendingJailSeizureChoice && gs.pendingJailSeizureChoice.seat === this.seat) {
      const pick = gs.pendingJailSeizureChoice.choices?.[0];
      if (typeof pick === 'number') this.send({ type: 'chooseJailSeizure', seat: this.seat, spaceIndex: pick });
      return;
    }
    if (gs.pendingCardChoice && gs.pendingCardChoice.seat === this.seat) {
      this.send({ type: 'skipCardChoice', seat: this.seat });
      return;
    }

    for (const loan of mySeat.loans ?? []) {
      if (loan.status === 'active' && loan.dueThisTurn) {
        if (mySeat.cash >= loan.installment) {
          this.send({ type: 'payLoanInstallment', seat: this.seat, loanId: loan.id });
        } else {
          this.send({ type: 'skipLoanInstallment', seat: this.seat, loanId: loan.id });
        }
        return;
      }
    }
    for (const loan of mySeat.mortgageLoans ?? []) {
      if (loan.status === 'active' && loan.dueThisTurn) {
        if (mySeat.cash >= loan.installment) {
          this.send({ type: 'payMortgageInstallment', seat: this.seat, loanId: loan.id });
        } else {
          this.send({ type: 'skipMortgageInstallment', seat: this.seat, loanId: loan.id });
        }
        return;
      }
    }

    const pa = gs.pendingAction;
    if (pa) {
      if (pa.type === 'buyDecision' && pa.seat === this.seat) {
        if ((mySeat.cash ?? 0) >= (pa.price ?? Infinity)) {
          this.send({ type: 'buyProperty', seat: this.seat });
        } else {
          this.send({ type: 'declineToBuy', seat: this.seat });
        }
        return;
      }
      if (pa.type === 'auction') {
        return;
      }
      if (pa.type === 'settleDebt' && pa.debtorSeat === this.seat) {
        const owned = Object.entries(gs.properties ?? {})
          .filter(([_, p]) => p.ownerSeat === this.seat && !p.mortgaged && (p.houses ?? 0) === 0)
          .map(([idx]) => Number(idx));
        if (owned.length > 0 && mySeat.cash < pa.amount) {
          this.send({ type: 'sellPropertyToBank', seat: this.seat, spaceIndex: owned[0] });
          return;
        }
        this.send({ type: 'declareBankruptcy', seat: this.seat });
        return;
      }
    }

    if (gs.turn?.seat !== this.seat) return;

    if (gs.turn.phase === 'preRoll') {
      if (mySeat.inJail) {
        const inflationFactor = gs.economy?.inflationFactor ?? 1;
        const jailFine = 50 * inflationFactor;
        if (mySeat.cash >= jailFine) this.send({ type: 'payJailFine', seat: this.seat });
        else this.send({ type: 'rollForJail', seat: this.seat });
        return;
      }
      this.send({ type: 'rollDice', seat: this.seat });
      return;
    }
    if (gs.turn.phase === 'endable') {
      this.send({ type: 'endTurn', seat: this.seat });
      return;
    }
  }
}

console.log(`▸ Connecting to ${DEPLOY_URL}`);
const wsA = await open('A');
const wsB = await open('B');
const botA = new Bot('A', wsA, 'BotA', 'topHat');
const botB = new Bot('B', wsB, 'BotB', 'thimble');

send(wsA, { type: 'createRoom', name: botA.name, tokenPiece: botA.tokenPiece });
await new Promise((r) => {
  const i = setInterval(() => { if (botA.roomCode) { clearInterval(i); r(); } }, 20);
});
send(wsB, { type: 'joinRoom', roomCode: botA.roomCode, name: botB.name, tokenPiece: botB.tokenPiece });
await new Promise((r) => {
  const i = setInterval(() => { if (botB.roomCode) { clearInterval(i); r(); } }, 20);
});
await sleep(300);
console.log(`▸ Starting game in room ${botA.roomCode}`);
send(wsA, { type: 'startGame' });

const t0 = Date.now();
let lastTurnCount = 0;
let lastProgress = Date.now();
while (Date.now() - t0 < HARD_DEADLINE_MS) {
  await sleep(500);
  const gs = botA.gameState ?? botB.gameState;
  if (!gs) continue;
  if (gs.phase === 'finished' || gs.winnerSeat != null) break;
  if ((gs.turnCount ?? 0) >= MAX_TURNS) break;
  if ((gs.turnCount ?? 0) > lastTurnCount) {
    lastTurnCount = gs.turnCount;
    lastProgress = Date.now();
  }
  if (Date.now() - lastProgress > TICK_BUDGET_MS) {
    console.log(`✗ No turn progress for ${TICK_BUDGET_MS}ms; aborting.`);
    break;
  }
  botA.maybeAct();
  botB.maybeAct();
}

await sleep(500);
const gs = botA.gameState ?? botB.gameState;
console.log('\n========== PLAYTEST SUMMARY ==========');
console.log(`Final phase: ${gs?.phase}`);
console.log(`Turn count: ${gs?.turnCount}`);
console.log(`Winner: ${gs?.winnerSeat ?? '(no winner)'}`);
console.log('');
console.log('Economy:');
console.log(`  inflationFactor: ${gs?.economy?.inflationFactor?.toFixed?.(6)} (started 1.000)`);
console.log(`  reserveRate: ${gs?.economy?.reserveRate?.toFixed?.(6)} (started 0.030)`);
console.log('');
console.log('Seats:');
for (const s of gs?.seats ?? []) {
  const owned = Object.values(gs.properties ?? {}).filter((p) => p.ownerSeat === s.seat).length;
  console.log(`  s${s.seat} (${s.name}): cash=$${s.cash?.toFixed?.(2)}  pos=${s.position}  owned=${owned}  bankrupt=${s.bankrupt}  inJail=${s.inJail}`);
}
console.log('');
const log = gs?.log ?? [];
const erosionEvents = log.filter((e) => e.type === 'inflationErosion');
const totalEroded = erosionEvents.reduce((a, e) => a + (e.payload?.totalEroded ?? 0), 0);
const flips = log.filter((e) => e.type === 'economyFlip');
const passGos = log.filter((e) => e.type === 'passGo');
const goAmounts = passGos.map((e) => e.payload?.amount).filter((n) => typeof n === 'number');
console.log('Economy events:');
console.log(`  economyFlip count:  ${flips.length}`);
console.log(`  inflationErosion count:  ${erosionEvents.length}`);
console.log(`  totalEroded across game:  $${totalEroded.toFixed(2)}`);
console.log(`  passGo count:  ${passGos.length}`);
if (goAmounts.length > 0) {
  console.log(`  passGo amounts: min=$${Math.min(...goAmounts).toFixed(2)}  max=$${Math.max(...goAmounts).toFixed(2)}`);
}
console.log('');
console.log('Rate trajectory (every 5th flip):');
flips.forEach((e, i) => {
  if (i % 5 !== 0 && i !== flips.length - 1) return;
  const p = e.payload;
  console.log(`  flip#${i + 1}: card.inf=${p.card?.inf?.toFixed?.(4)}  policyDelta=${p.policyDelta?.toFixed?.(4)}  inf=${p.inflationFactor?.toFixed?.(4)}  rate=${p.reserveRate?.toFixed?.(4)}${p.intIgnored ? ' intIgnored' : ''}`);
});

wsA.close();
wsB.close();
setTimeout(() => process.exit(0), 200);
