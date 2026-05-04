<script>
  let { seat, index, mine } = $props();
</script>

<div
  class="token"
  class:mine
  style:background={`var(--player-${seat.seat})`}
  title={`${seat.name} ($${seat.cash})`}
>
  {seat.name.charAt(0).toUpperCase()}
</div>

<style>
  .token {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    color: #fff;
    font-size: 0.65rem;
    font-weight: bold;
    border: 2px solid #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 1px 3px rgba(0,0,0,0.4);
  }
  .token.mine {
    border-color: #000;
  }
</style>
