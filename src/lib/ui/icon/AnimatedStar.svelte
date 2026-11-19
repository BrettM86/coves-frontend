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

  const SPARK_COUNT = 8
  const sparkAngles = Array.from(
    { length: SPARK_COUNT },
    (_, i) => (2 * Math.PI * i) / SPARK_COUNT - Math.PI / 2,
  )
</script>

<span
  class="animated-star"
  style="width: {size}px; height: {size}px; --star-size: {size}px; --spark-color: {sparkColor};"
>
  {#if animating}
    {#each sparkAngles as angle, index}
      <span
        class="spark"
        class:long={index % 2 === 0}
        style="--angle: {angle}rad; --angle-cos: {Math.cos(
          angle,
        )}; --angle-sin: {Math.sin(angle)};"
      ></span>
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

  /* Sparks: thin streaks flung outward from the centre, then fading. */
  .spark {
    position: absolute;
    width: 2px;
    height: 5px;
    border-radius: 1px;
    background-color: var(--spark-color);
    pointer-events: none;
    opacity: 0;
    --distance: calc(var(--star-size) * 1.15);
    animation: spark-fling 700ms ease-out forwards;
  }

  .spark.long {
    height: 7px;
    --distance: calc(var(--star-size) * 1.35);
  }

  @keyframes spark-fling {
    0%,
    35% {
      transform: translate(0, 0) rotate(calc(var(--angle) + 90deg));
      opacity: 0;
    }
    45% {
      opacity: 1;
    }
    75% {
      transform: translate(
          calc(var(--angle-cos) * var(--distance)),
          calc(var(--angle-sin) * var(--distance))
        )
        rotate(calc(var(--angle) + 90deg));
      opacity: 1;
    }
    100% {
      transform: translate(
          calc(var(--angle-cos) * var(--distance) * 1.2),
          calc(var(--angle-sin) * var(--distance) * 1.2)
        )
        rotate(calc(var(--angle) + 90deg)) scale(0.4);
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
