<script lang="ts">
  import { untrack } from 'svelte'
  import { Icon, Star } from '$lib/ui/kit/icon'

  interface Props {
    starred: boolean
    size?: number
    sparkColor?: string
  }

  // Amber sparks on purpose: a celebratory burst, not the star's own colour.
  let { starred, size = 16, sparkColor = '#F59E0B' }: Props = $props()

  // Same edge trigger as AnimatedHeart: the burst plays on a false -> true
  // change only, never on first render or when a star is cleared. The latch
  // is a plain `let`, so writing it from the effect can't re-trigger it.
  let animating = $state(false)
  let wasStarred = untrack(() => starred)

  $effect(() => {
    const current = starred
    if (current && !wasStarred) {
      animating = true
      const timeout = setTimeout(() => {
        animating = false
      }, 700)
      wasStarred = current
      // Unstarred mid-burst (a quick undo or a failed request rolling back):
      // drop the burst so the next star can play it again.
      return () => {
        clearTimeout(timeout)
        animating = false
      }
    }
    wasStarred = current
  })

  // Each tip releases a streak at the 60% spin keyframe (360°, scale 1.35).
  const reaches = [1, 0.82, 1.08, 0.88, 0.96]
  const DEG = Math.PI / 180

  function point(angle: number, distance: number): [number, number] {
    return [Math.cos(angle) * distance, Math.sin(angle) * distance]
  }

  let sparks = $derived(
    reaches.map((length, i) => {
      const tip = -90 * DEG + i * 72 * DEG
      const reach = size * length
      const [sx, sy] = point(tip, (size * 10 * 1.35) / 24)
      const [mx, my] = point(tip + 80 * DEG, reach * 0.55)
      const [ex, ey] = point(tip + 55 * DEG, reach)
      return {
        style: [
          `--length: ${size * 0.34 * length}px`,
          `--sx: ${sx}px; --sy: ${sy}px`,
          `--mx: ${sx + mx}px; --my: ${sy + my}px`,
          `--ex: ${sx + ex}px; --ey: ${sy + ey}px`,
          // Streaks point along their path: first tangent, then bending out.
          `--a1: ${tip + 80 * DEG + Math.PI / 2}rad`,
          `--a2: ${tip + 55 * DEG + Math.PI / 2}rad`,
        ].join('; '),
      }
    }),
  )
</script>

<span
  class="animated-star"
  style="width: {size}px; height: {size}px; --spark-color: {sparkColor};"
>
  {#if animating}
    {#each sparks as spark}
      <span class="spark" style={spark.style}></span>
    {/each}
  {/if}
  <span class="star" class:animating>
    <Icon src={Star} {size} class={[starred && 'fill-current']} />
  </span>
</span>

<style>
  /* Block-level flex, so no text line box adds height inside the button. */
  .animated-star {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: visible;
  }

  .star {
    display: inline-flex;
  }

  /* Spin one and a fifth turns (a star looks the same every fifth) while popping. */
  .star.animating {
    animation: star-spin 700ms cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
  }

  @keyframes star-spin {
    0% {
      transform: rotate(0deg) scale(1);
    }
    20% {
      transform: rotate(-30deg) scale(0.6);
    }
    60% {
      transform: rotate(360deg) scale(1.35);
    }
    80% {
      transform: rotate(432deg) scale(0.92);
    }
    100% {
      transform: rotate(432deg) scale(1);
    }
  }

  /* Sparks: streaks thrown off the tips along the spin, then fading. */
  .spark {
    position: absolute;
    width: 2px;
    height: var(--length);
    border-radius: 1px;
    background: linear-gradient(#fff1b8, var(--spark-color) 52%, transparent);
    clip-path: polygon(20% 0, 80% 0, 100% 30%, 50% 100%, 0 30%);
    pointer-events: none;
    opacity: 0;
    animation: spark-throw 180ms cubic-bezier(0.15, 0.7, 0.4, 1) 420ms forwards;
  }

  @keyframes spark-throw {
    0% {
      transform: translate(var(--sx), var(--sy)) rotate(var(--a1));
      opacity: 1;
    }
    45% {
      transform: translate(var(--mx), var(--my)) rotate(var(--a1));
      opacity: 1;
    }
    100% {
      transform: translate(var(--ex), var(--ey)) rotate(var(--a2)) scale(0.3);
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .star.animating,
    .spark {
      animation: none;
    }

    .spark {
      display: none;
    }
  }
</style>
