<script lang="ts">
  interface Props {
    liked: boolean
    size?: number
    color?: string
    likedColor?: string
  }

  let {
    liked,
    size = 20,
    color = 'currentColor',
    likedColor = '#FF0033',
  }: Props = $props()

  let animating = $state(false)
  let wasLiked = liked

  $effect(() => {
    const currentLiked = liked
    if (currentLiked && !wasLiked) {
      animating = true
      const timeout = setTimeout(() => {
        animating = false
      }, 800)
      wasLiked = currentLiked
      return () => clearTimeout(timeout)
    }
    wasLiked = currentLiked
  })

  const PARTICLE_COUNT = 7
  const particleAngles = Array.from(
    { length: PARTICLE_COUNT },
    (_, i) => (2 * Math.PI * i) / PARTICLE_COUNT,
  )
</script>

<span
  class="animated-heart"
  style="width: {size}px; height: {size}px; --heart-size: {size}px; --heart-color: {liked
    ? likedColor
    : color}; --liked-color: {likedColor};"
>
  <span class="heart-container" class:animating>
    {#if animating}
      <!-- Phase 2: Expanding hollow circle -->
      <span class="circle-burst"></span>
      <!-- Phase 4: Particle burst -->
      {#each particleAngles as angle}
        <span
          class="particle"
          style="--angle-cos: {Math.cos(angle)}; --angle-sin: {Math.sin(
            angle,
          )};"
        ></span>
      {/each}
    {/if}

    <!-- Heart SVG -->
    <svg
      class="heart-svg"
      class:animating
      viewBox="0 0 24 24"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {#if liked}
        <!-- Filled heart path from Bluesky Heart2 icon -->
        <path
          d="M12.489,21.372 C21.017,16.592 23.115,10.902 21.511,6.902 C20.732,4.961 19.097,3.569 17.169,3.139 C15.472,2.761 13.617,3.142 12,4.426 C10.383,3.142 8.528,2.761 6.83,3.139 C4.903,3.569 3.268,4.961 2.49,6.903 C0.885,10.903 2.983,16.593 11.511,21.373 C11.826,21.558 12.174,21.558 12.489,21.372Z"
          fill="var(--heart-color)"
        />
      {:else}
        <!-- Outline heart path from Bluesky Heart2 icon -->
        <path
          d="M16.734,5.091 C15.496,4.815 14.026,5.138 12.712,6.471 C12.318,6.865 11.682,6.865 11.288,6.471 C9.974,5.137 8.504,4.814 7.266,5.09 C6.003,5.372 4.887,6.296 4.346,7.646 C3.33,10.18 4.252,14.84 12,19.348 C19.747,14.84 20.67,10.18 19.654,7.648 C19.113,6.297 17.997,5.373 16.734,5.091Z M21.511,6.903 C23.115,10.903 21.017,16.593 12.489,21.373 C12.174,21.558 11.826,21.558 11.511,21.373 C2.983,16.592 0.885,10.902 2.49,6.902 C3.269,4.96 4.904,3.568 6.832,3.138 C8.529,2.76 10.384,3.141 12.001,4.424 C13.618,3.141 15.473,2.76 17.171,3.138 C19.098,3.568 20.733,4.96 21.511,6.903Z"
          fill="var(--heart-color)"
        />
      {/if}
    </svg>
  </span>
</span>

<style>
  .animated-heart {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: visible;
  }

  .heart-container {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    overflow: visible;
  }

  .heart-svg {
    display: block;
    flex-shrink: 0;
  }

  /* Phase 1 (0-15%): shrink to 0, Phase 3 (25-55%): grow to 1.3, Phase 5 (65-100%): settle to 1 */
  .heart-svg.animating {
    animation: heart-pop 800ms ease-out forwards;
  }

  @keyframes heart-pop {
    0% {
      transform: scale(1);
    }
    15% {
      transform: scale(0);
    }
    25% {
      transform: scale(0.2);
    }
    55% {
      transform: scale(1.3);
    }
    65% {
      transform: scale(1.3);
    }
    75% {
      transform: scale(0.9);
    }
    85% {
      transform: scale(1.05);
    }
    100% {
      transform: scale(1);
    }
  }

  /* Phase 2 (15-40%): Red hollow circle expands */
  .circle-burst {
    position: absolute;
    width: var(--heart-size);
    height: var(--heart-size);
    border-radius: 50%;
    border: 2px solid var(--liked-color);
    animation: circle-expand 800ms ease-out forwards;
    pointer-events: none;
  }

  @keyframes circle-expand {
    0% {
      transform: scale(0);
      opacity: 0;
    }
    15% {
      transform: scale(0);
      opacity: 0;
    }
    27% {
      transform: scale(1);
      opacity: 0.8;
    }
    40% {
      transform: scale(2);
      opacity: 0;
    }
    100% {
      transform: scale(2);
      opacity: 0;
    }
  }

  /* Phase 4 (55-65%): Particle dots burst outward */
  .particle {
    position: absolute;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background-color: var(--liked-color);
    animation: particle-burst 800ms ease-out forwards;
    pointer-events: none;
    --distance: calc(var(--heart-size) * 1.2);
  }

  @keyframes particle-burst {
    0% {
      transform: translate(0, 0);
      opacity: 0;
    }
    55% {
      transform: translate(0, 0);
      opacity: 0;
    }
    60% {
      opacity: 1;
    }
    65% {
      transform: translate(
        calc(var(--angle-cos) * var(--distance)),
        calc(var(--angle-sin) * var(--distance))
      );
      opacity: 1;
    }
    75% {
      transform: translate(
        calc(var(--angle-cos) * var(--distance)),
        calc(var(--angle-sin) * var(--distance))
      );
      opacity: 0;
    }
    100% {
      transform: translate(
        calc(var(--angle-cos) * var(--distance)),
        calc(var(--angle-sin) * var(--distance))
      );
      opacity: 0;
    }
  }
</style>
