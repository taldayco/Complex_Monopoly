<script>
  import { fmtCash as fmt } from '$lib/client/format.js';
  import { getEventCard } from '$lib/shared/reserve/eventCardCatalog.js';

  let { card, onClose } = $props();

  // Two card shapes are supported:
  //   legacy:  { deck: 'chance' | 'communityChest', text }
  //   reserve: { kind: 'reserve', deck: 'chance' | 'community', cardId, results }
  const isReserve = $derived(card?.kind === 'reserve');
  const reserveDef = $derived(isReserve ? getEventCard(card.deck, card.cardId) : null);
  const headerLabel = $derived(
    isReserve
      ? (card.deck === 'chance' ? 'Chance' : 'Community Chest')
      : (card.deck === 'chance' ? 'Chance' : 'Community Chest')
  );
  const variantClass = $derived(
    isReserve
      ? (card.deck === 'chance' ? 'chance' : 'communityChest')
      : card.deck
  );


  function describeEffect(eff) {
    switch (eff.kind) {
      case 'cash':
        return `${eff.amount >= 0 ? '+' : '−'}$${fmt(Math.abs(eff.amount))} cash`;
      case 'creditScoreDelta':
        return `Credit ${eff.delta >= 0 ? '+' : ''}${eff.delta} → ${eff.scoreAfter}`;
      case 'dividend':
        return eff.shares > 0
          ? `Dividend $${fmt(eff.paid)} (${eff.shares} ${eff.symbol} × ${(eff.pct * 100).toFixed(0)}%)`
          : `Dividend skipped — no ${eff.symbol} shares`;
      case 'flatDividend':
        return eff.paid > 0
          ? `Flat dividend +$${fmt(eff.paid)}`
          : 'Dividend skipped — no shares';
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
        return `Loan: $${fmt(eff.principal)} / ${eff.term} turns / ${(eff.ptr * 100).toFixed(2)}% PTR`;
      case 'bankPaysInstallment':
        return eff.skipped
          ? 'Bank-pays-installment: no eligible loan'
          : `Bank paid $${fmt(eff.amount)} on loan ${eff.loanId}`;
      case 'revealWildcards': {
        if (eff.skipped || !Array.isArray(eff.wildCards)) return `Insider tip — ${eff.symbol ?? '?'}`;
        const pills = eff.wildCards.map((v) => (v > 0 ? '+' : '') + v + '%').join(', ');
        const left = typeof eff.inDeck === 'number' ? `, ${eff.inDeck} still in deck` : '';
        return `Insider tip — ${eff.symbol} wildcards: ${pills}${left}`;
      }
      default:
        return eff.kind;
    }
  }
</script>

<div class="overlay" onclick={onClose} role="presentation">
  <div class="modal {variantClass}" onclick={(e) => e.stopPropagation()} role="dialog">
    <h3>{headerLabel}</h3>
    {#if isReserve && reserveDef}
      <h4 class="card-name">{reserveDef.name}</h4>
      <p class="card-text">{reserveDef.blurb}</p>
      {#if Array.isArray(card.results?.effects) && card.results.effects.length > 0}
        <ul class="effects">
          {#each card.results.effects as eff, i (i)}
            <li>{describeEffect(eff)}</li>
          {/each}
        </ul>
      {/if}
    {:else}
      <p class="card-text">{card.text}</p>
    {/if}
    <button class="primary" onclick={onClose}>OK</button>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 180;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: #fff;
    border: 2px solid var(--line);
    border-radius: 8px;
    padding: 1.5rem;
    width: 380px;
    max-width: 90vw;
    text-align: center;
  }
  .modal.chance { background: #fde7c2; }
  .modal.communityChest { background: #c2dffd; }
  h3 {
    margin-top: 0;
    font-family: 'Georgia', serif;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .card-text {
    font-size: 1.05rem;
    margin: 1rem 0 1rem;
  }
  .card-name {
    margin: 0.6rem 0 0.2rem;
    font-size: 1rem;
  }
  .effects {
    list-style: disc;
    padding-left: 1.2rem;
    margin: 0.4rem 0 1rem;
    text-align: left;
    font-size: 0.9rem;
  }
  .effects li { margin: 0.15rem 0; }
</style>
