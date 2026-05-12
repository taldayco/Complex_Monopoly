<script>
  import { BOARD } from '$lib/shared/board.js';
  let { log, seats } = $props();

  const recent = $derived((log ?? []).slice(-80).reverse());

  function fmt(e) {
    const name = e.seat != null ? seats[e.seat]?.name ?? `Seat ${e.seat}` : null;
    switch (e.type) {
      case 'gameStart': return 'The game has started.';
      case 'turnStart': return `${name}'s turn.`;
      case 'rollDice': return `${name} rolled ${e.payload.d1} + ${e.payload.d2}${e.payload.doubles ? ' (doubles!)' : ''}.`;
      case 'land': return `${name} landed on ${e.payload.name}.`;
      case 'passGo': return `${name} passed GO and collected $${e.payload.amount}.`;
      case 'offerBuy': return `${name} can buy ${BOARD[e.payload.spaceIndex].name} for $${e.payload.price}.`;
      case 'buy': return `${name} bought ${BOARD[e.payload.spaceIndex].name} for $${e.payload.price}.`;
      case 'auctionStart': return `${BOARD[e.payload.spaceIndex].name} is up for auction.`;
      case 'bid': return `${name} bid $${e.payload.amount}.`;
      case 'passAuction': return `${name} passed.`;
      case 'auctionEnd':
        return e.payload.soldTo != null
          ? `${seats[e.payload.soldTo].name} won ${BOARD[e.payload.spaceIndex].name} for $${e.payload.price}.`
          : `${BOARD[e.payload.spaceIndex].name} unsold.`;
      case 'rentDue': return `${name} owes ${seats[e.payload.creditor].name} $${e.payload.amount}.`;
      case 'pay': return `${name} paid $${e.payload.amount}.`;
      case 'collect': return `${name} collected $${e.payload.amount}.`;
      case 'toJail': return `${name} was sent to jail.`;
      case 'jailRoll': return `${name} rolled ${e.payload.d1}+${e.payload.d2} for jail${e.payload.released ? ' — released' : ''}.`;
      case 'jailFinePaid': return `${name} paid the $50 jail fine.`;
      case 'jailFree': return `${name} used a Get-Out-of-Jail-Free card.`;
      case 'threeDoubles': return `${name} rolled three doubles!`;
      case 'drawCard': return `${name} drew: "${e.payload.text}"`;
      case 'getJailCard': return `${name} kept a Get-Out-of-Jail-Free card.`;
      case 'payEachPlayer': return `${name} paid $${e.payload.amount} to each of ${e.payload.others} players.`;
      case 'collectFromEachPlayer': return `${name} collected $${e.payload.amount} from each of ${e.payload.others} players.`;
      case 'mortgage': return `${name} mortgaged ${BOARD[e.payload.spaceIndex].name} for $${e.payload.payout}.`;
      case 'unmortgage': return `${name} unmortgaged ${BOARD[e.payload.spaceIndex].name} for $${e.payload.cost}.`;
      case 'buyHouse': return `${name} built on ${BOARD[e.payload.spaceIndex].name} (${e.payload.houses === 5 ? 'hotel' : e.payload.houses + ' houses'}).`;
      case 'sellHouse': return `${name} sold a building on ${BOARD[e.payload.spaceIndex].name} for $${e.payload.refund}.`;
      case 'tradeProposed': return `${name} proposed a trade to ${seats[e.payload.toSeat].name}.`;
      case 'tradeExecuted': return `Trade between ${seats[e.payload.fromSeat].name} and ${seats[e.payload.toSeat].name} completed.`;
      case 'tradeDeclined': return `${name} declined the trade.`;
      case 'tradeCancelled': return `${name} cancelled the trade.`;
      case 'settleDebt': return `${name} owes $${e.payload.amount}.`;
      case 'debtSettled': return `${name} settled their debt of $${e.payload.amount}.`;
      case 'bankrupt':
        return e.payload.creditorSeat != null
          ? `${name} went bankrupt; assets transferred to ${seats[e.payload.creditorSeat].name}.`
          : `${name} went bankrupt; assets returned to the bank.`;
      case 'gameOver':
        return e.payload.winnerSeat != null
          ? `Game over! ${seats[e.payload.winnerSeat].name} wins!`
          : 'Game over.';
      case 'rollAgain': return `${name} rolled doubles — roll again.`;
      case 'skipPlayer': return `${name} was skipped (disconnected).`;
      case 'utilityRoll': return `${name} rolled ${e.payload.d1}+${e.payload.d2} for utility rent.`;
      case 'inflationErosion': return `Inflation eroded $${Number(e.payload.totalEroded).toFixed(2)} of cash holdings.`;
      default: return `${name ?? '—'}: ${e.type}`;
    }
  }
</script>

<div class="log">
  <h4>Game Log</h4>
  <div class="entries">
    {#each recent as e (e.ts + e.type)}
      <div class="entry">{fmt(e)}</div>
    {/each}
  </div>
</div>

<style>
  .log {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 0.6rem;
  }
  h4 { margin: 0 0 0.4rem 0; font-size: 0.9rem; }
  .entries {
    flex: 1;
    overflow-y: auto;
    font-size: 0.78rem;
    color: var(--ink-mute);
    line-height: 1.4;
  }
  .entry {
    padding: 0.2rem 0;
    border-bottom: 1px dotted #ddd;
  }
</style>
