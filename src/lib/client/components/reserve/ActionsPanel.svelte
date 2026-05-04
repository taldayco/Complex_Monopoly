<script>
  import { send } from '$lib/client/socket.js';
  import { getEventCard } from '$lib/shared/reserve/eventCardCatalog.js';

  let { state: gs, mySeat } = $props();

  const me = $derived(gs.seats.find((s) => s.seat === mySeat));
  const isMyTurn = $derived(gs.turn?.seat === mySeat);
  const phase = $derived(gs.turn?.phase);
  const canDraw = $derived(
    isMyTurn &&
      (phase === 'preRoll' || phase === 'endable') &&
      !me?.bankrupt &&
      me?.drewEventCardThisTurn !== true
  );
  const community = $derived(gs.reserveDecks?.community ?? { deckSize: 0, discardSize: 0 });
  const chance = $derived(gs.reserveDecks?.chance ?? { deckSize: 0, discardSize: 0 });
  const lastCard = $derived(me?.lastDrawnEventCard ?? null);
  const lastCardDef = $derived(lastCard ? getEventCard(lastCard.deck, lastCard.cardId) : null);
  const tempEffects = $derived(Array.isArray(me?.tempEffects) ? me.tempEffects : []);

  function fmt(v) {
    if (typeof v !== 'number') return '—';
    return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function draw(deck) {
    send({ type: 'flipEventCard', deck });
  }
  function dismiss() {
    send({ type: 'dismissEventCard' });
  }

  function describeEffect(eff) {
    switch (eff.kind) {
      case 'cash':
        return `${eff.amount >= 0 ? '+' : '−'}$${fmt(Math.abs(eff.amount))} cash`;
      case 'creditScoreDelta':
        return `Credit ${eff.delta >= 0 ? '+' : ''}${eff.delta} → ${eff.scoreAfter}`;
      case 'dividend':
        return eff.shares > 0
          ? `Dividend $${fmt(eff.paid)} (${eff.shares} ${eff.symbol} × ${(eff.pct * 100).toFixed(0)}%)`
          : `Dividend skipped — no ${eff.symbol} shares held`;
      case 'flatDividend':
        return eff.paid > 0
          ? `Flat dividend +$${fmt(eff.paid)}`
          : 'Dividend skipped — no shares held';
      case 'shareGrant':
        return `Granted ${eff.granted} share${eff.granted === 1 ? '' : 's'} of ${eff.symbol}`;
      case 'shareGrantAll':
        return `Granted ${eff.granted} share${eff.granted === 1 ? '' : 's'} of every volatile stock`;
      case 'marketShock': {
        const sym = Object.keys(eff.moves ?? {});
        return `Market ${eff.pct >= 0 ? '+' : ''}${eff.pct}% (${sym.length} stocks)`;
      }
      case 'stockShock':
        return `${eff.symbol} ${eff.pct >= 0 ? '+' : ''}${eff.pct}% ($${fmt(eff.from)} → $${fmt(eff.to)})`;
      case 'tempEffect':
        return `Effect: ${eff.effectId} for ${eff.turns} turn${eff.turns === 1 ? '' : 's'}`;
      case 'specialLoan':
        return `Loan: $${fmt(eff.principal)} / ${eff.term} turns / ${(eff.ptr * 100).toFixed(2)}% PTR (total $${fmt(eff.totalDebt)})`;
      case 'bankPaysInstallment':
        return eff.skipped
          ? 'Bank-pays-installment: no eligible loan'
          : `Bank paid $${fmt(eff.amount)} on loan ${eff.loanId}`;
      default:
        return eff.kind;
    }
  }

  function describeTempEffect(e) {
    const s = e.expiresInTurns;
    const turns = `${s} turn${s === 1 ? '' : 's'}`;
    switch (e.effectId) {
      case 'doubleMaxLine': return `2× max loan line · ${turns} left`;
      case 'tierBoost': return `Treated as +${e.payload?.tiers ?? 1} tier · ${turns} left`;
      case 'zeroInterestNextLoan': return `Next loan at 0% PTR · ${turns} left`;
      case 'halfCardFees': return `Card fees halved · ${turns} left`;
      default: return `${e.effectId} · ${turns} left`;
    }
  }
</script>

<div class="actions-panel">
  {#if lastCard && lastCardDef}
    <section class="last-card">
      <div class="head">
        <span class="deck-tag deck-{lastCard.deck}">{lastCard.deck}</span>
        <h3>{lastCardDef.name}</h3>
        <button class="dismiss" onclick={dismiss}>×</button>
      </div>
      <p class="blurb">{lastCardDef.blurb}</p>
      {#if lastCard.results?.effects?.length > 0}
        <ul class="effects">
          {#each lastCard.results.effects as eff (eff.kind + (eff.symbol ?? '') + (eff.effectId ?? ''))}
            <li>{describeEffect(eff)}</li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  <section class="draw-row">
    <button
      class="draw community"
      onclick={() => draw('community')}
      disabled={!canDraw || community.deckSize === 0 && community.discardSize === 0}
    >
      <strong>Community</strong>
      <span class="sub">{community.deckSize} in deck · {community.discardSize} discarded</span>
    </button>
    <button
      class="draw chance"
      onclick={() => draw('chance')}
      disabled={!canDraw || chance.deckSize === 0 && chance.discardSize === 0}
    >
      <strong>Chance</strong>
      <span class="sub">{chance.deckSize} in deck · {chance.discardSize} discarded</span>
    </button>
  </section>

  {#if !isMyTurn}
    <p class="hint">Wait for your turn to draw.</p>
  {:else if me?.drewEventCardThisTurn}
    <p class="hint">You've already drawn an event this turn.</p>
  {:else}
    <p class="hint">You may draw <strong>once per turn</strong> from either deck.</p>
  {/if}

  <section class="active-effects">
    <h3>Active effects</h3>
    {#if tempEffects.length === 0}
      <p class="empty">None.</p>
    {:else}
      <ul>
        {#each tempEffects as e (e.id)}
          <li>{describeTempEffect(e)}</li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .actions-panel { display: flex; flex-direction: column; gap: 1rem; }
  section { padding: 0.6rem 0.8rem; background: var(--bg); border: 1px solid var(--panel-border); border-radius: 6px; }
  section h3 { margin: 0 0 0.4rem; font-size: 0.95rem; }

  .last-card { border-color: var(--accent); background: rgba(46, 125, 50, 0.04); }
  .last-card .head { display: flex; align-items: center; gap: 0.5rem; }
  .last-card .head h3 { margin: 0; flex: 1; }
  .deck-tag {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    color: #fff;
  }
  .deck-tag.deck-community { background: var(--good, #2e7d32); }
  .deck-tag.deck-chance { background: var(--warn, #ed6c02); }
  .last-card .dismiss { font-size: 1.2rem; padding: 0 0.4rem; cursor: pointer; }
  .last-card .blurb { margin: 0.3rem 0; font-size: 0.85rem; color: var(--ink-mute); }
  .last-card .effects { list-style: disc; padding-left: 1.2rem; margin: 0.3rem 0 0; font-size: 0.82rem; }
  .last-card .effects li { margin: 0.15rem 0; }

  .draw-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; padding: 0; background: transparent; border: none; }
  .draw {
    padding: 0.9rem 1rem;
    border-radius: 8px;
    border: 2px solid var(--panel-border);
    background: var(--panel);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    align-items: center;
    transition: border-color 0.15s ease;
  }
  .draw:hover:not(:disabled) { border-color: var(--accent); }
  .draw:disabled { opacity: 0.5; cursor: not-allowed; }
  .draw strong { font-size: 1rem; }
  .draw.community strong { color: var(--good, #2e7d32); }
  .draw.chance strong { color: var(--warn, #ed6c02); }
  .draw .sub { font-size: 0.72rem; color: var(--ink-mute); }

  .hint { margin: 0; text-align: center; color: var(--ink-mute); font-size: 0.85rem; font-style: italic; }
  .active-effects ul { list-style: none; padding: 0; margin: 0; font-size: 0.85rem; }
  .active-effects li { padding: 0.25rem 0; border-bottom: 1px dashed var(--panel-border); }
  .active-effects .empty { color: var(--ink-mute); font-style: italic; margin: 0.2rem 0; font-size: 0.85rem; }
</style>
