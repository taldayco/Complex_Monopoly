<script>
  let { card, onClose } = $props();
</script>

<div class="overlay" onclick={onClose} role="presentation">
  <div class="modal {card.deck}" onclick={(e) => e.stopPropagation()} role="dialog">
    <h3>{card.deck === 'chance' ? 'Chance' : 'Community Chest'}</h3>
    <p class="card-text">{card.text}</p>
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
    margin: 1rem 0 1.5rem;
  }
</style>
