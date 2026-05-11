<script>
  import { fmtPrice as fmt } from '$lib/client/format.js';
  let {
    history = [],
    width = 480,
    height = 140,
    showAxis = true,
    strokeWidth = 2
  } = $props();

  const points = $derived(Array.isArray(history) ? history.filter((v) => typeof v === 'number') : []);

  const stats = $derived.by(() => {
    if (points.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const v of points) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === max) {
      const pad = Math.max(min * 0.05, 0.5);
      min -= pad;
      max += pad;
    } else {
      const pad = (max - min) * 0.08;
      min -= pad;
      max += pad;
    }
    return { min, max, first: points[0], last: points[points.length - 1] };
  });

  const padL = $derived(showAxis ? 36 : 2);
  const padR = 4;
  const padT = 6;
  const padB = $derived(showAxis ? 16 : 2);

  function x(i, n) {
    if (n <= 1) return padL;
    return padL + ((width - padL - padR) * i) / (n - 1);
  }
  function y(v, min, max) {
    if (max === min) return height / 2;
    return padT + (height - padT - padB) * (1 - (v - min) / (max - min));
  }

  const path = $derived.by(() => {
    if (!stats) return '';
    const n = points.length;
    return points
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i, n).toFixed(2)},${y(v, stats.min, stats.max).toFixed(2)}`)
      .join(' ');
  });

  const areaPath = $derived.by(() => {
    if (!stats || points.length === 0) return '';
    const n = points.length;
    const baseY = (height - padB).toFixed(2);
    const top = points
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i, n).toFixed(2)},${y(v, stats.min, stats.max).toFixed(2)}`)
      .join(' ');
    return `${top} L${x(n - 1, n).toFixed(2)},${baseY} L${x(0, n).toFixed(2)},${baseY} Z`;
  });

  const trend = $derived(stats ? (stats.last >= stats.first ? 'up' : 'down') : 'flat');

</script>

{#if points.length === 0}
  <div class="empty" style:width="{width}px" style:height="{height}px">no data yet</div>
{:else}
  <svg viewBox="0 0 {width} {height}" class="chart {trend}" preserveAspectRatio="none">
    {#if showAxis}
      <line x1={padL} x2={padL} y1={padT} y2={height - padB} class="axis" />
      <line x1={padL} x2={width - padR} y1={height - padB} y2={height - padB} class="axis" />
      <text x="2" y={padT + 8} class="tick">${fmt(stats.max)}</text>
      <text x="2" y={height - padB} class="tick">${fmt(stats.min)}</text>
    {/if}
    <path d={areaPath} class="area" />
    <path d={path} class="line" stroke-width={strokeWidth} fill="none" />
    <circle
      cx={x(points.length - 1, points.length)}
      cy={y(points[points.length - 1], stats.min, stats.max)}
      r="3"
      class="dot"
    />
  </svg>
{/if}

<style>
  .chart { display: block; }
  .chart.up .line { stroke: var(--good, #2e7d32); }
  .chart.down .line { stroke: var(--danger, #c62828); }
  .chart.flat .line { stroke: var(--ink-mute, #888); }
  .chart.up .area { fill: rgba(46, 125, 50, 0.12); }
  .chart.down .area { fill: rgba(198, 40, 40, 0.12); }
  .chart.flat .area { fill: rgba(120, 120, 120, 0.10); }
  .chart.up .dot { fill: var(--good, #2e7d32); }
  .chart.down .dot { fill: var(--danger, #c62828); }
  .chart.flat .dot { fill: var(--ink-mute, #888); }
  .axis { stroke: var(--panel-border, #ddd); stroke-width: 1; }
  .tick { font-family: monospace; font-size: 9px; fill: var(--ink-mute, #888); }
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-mute, #888);
    font-size: 0.75rem;
    font-style: italic;
    border: 1px dashed var(--panel-border, #ddd);
    border-radius: 4px;
  }
</style>
