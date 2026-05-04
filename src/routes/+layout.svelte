<script>
  import '../app.css';
  let { children } = $props();
</script>

<div class="too-small">
  This game is designed for desktop. Please use a screen at least 900px wide.
</div>

<div class="game-root">
  {@render children()}
</div>
