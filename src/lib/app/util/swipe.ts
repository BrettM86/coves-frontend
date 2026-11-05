export type SwipeDirection = 'left' | 'right' | 'up' | 'down'

/** Travel along the dominant axis that always counts as a swipe. */
const SWIPE_DISTANCE = 50
/** A shorter flick counts when it is at least this long and this fast. */
const FLICK_DISTANCE = 30
const FLICK_SPEED = 0.5 // px/ms
/** The dominant axis must be this many times the other, so diagonals don't count. */
const DOMINANCE = 1.5
/** A flick is judged by the movement over this long before release. */
const RELEASE_WINDOW_MS = 100

/** Where a tracked finger was, and when (event.timeStamp, ms). */
export interface SwipeSample {
  x: number
  y: number
  time: number
}

/** A finished one-finger contact. */
export interface SwipeRelease {
  /** Net offset from where the finger landed, in px. */
  dx: number
  dy: number
  /** From landing to release. */
  ms: number
  /** Velocity over the last ~100ms before release, in px/ms. */
  vx: number
  vy: number
  /** The direction of a flick at release, judged by that recent movement. */
  flick: SwipeDirection | null
}

/** The dominant direction of a movement, or null on a diagonal. */
function dominant(
  dx: number,
  dy: number,
): { direction: SwipeDirection; along: number } | null {
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const along = horizontal ? Math.abs(dx) : Math.abs(dy)
  const across = horizontal ? Math.abs(dy) : Math.abs(dx)
  if (along === 0 || along < DOMINANCE * across) return null
  const direction = horizontal
    ? dx < 0
      ? 'left'
      : 'right'
    : dy < 0
      ? 'up'
      : 'down'
  return { direction, along }
}

/** The direction of `dx`, `dy` px moved over `ms`, when that is a flick. */
function flickDirection(
  dx: number,
  dy: number,
  ms: number,
): SwipeDirection | null {
  const move = dominant(dx, dy)
  if (!move) return null
  const fast =
    move.along >= FLICK_DISTANCE && move.along / Math.max(ms, 1) >= FLICK_SPEED
  return fast ? move.direction : null
}

/**
 * The release of a contact from its samples, landing first and release last.
 * Release speed and direction come from the oldest sample in the last
 * ~100ms, or the last one before that when the finger held still.
 */
export function swipeRelease(
  samples: readonly [SwipeSample, ...SwipeSample[]],
): SwipeRelease {
  const start = samples[0]
  const end = samples.at(-1) ?? start
  const earlier = samples.filter((sample) => sample.time < end.time)
  const reference =
    earlier.find((sample) => sample.time >= end.time - RELEASE_WINDOW_MS) ??
    earlier.at(-1) ??
    end
  const recentMs = end.time - reference.time
  const recentDx = end.x - reference.x
  const recentDy = end.y - reference.y
  return {
    dx: end.x - start.x,
    dy: end.y - start.y,
    ms: end.time - start.time,
    vx: recentDx / Math.max(recentMs, 1),
    vy: recentDy / Math.max(recentMs, 1),
    flick: flickDirection(recentDx, recentDy, recentMs),
  }
}

/**
 * The direction of a finished contact that moved `dx`, `dy` pixels over `ms`
 * milliseconds, or null when it was not a swipe: 50px along a dominant axis,
 * or a flick. A release's `flick` is used when given; without it the flick is
 * judged over the whole contact.
 */
export function classifySwipe({
  dx,
  dy,
  ms,
  flick,
}: {
  dx: number
  dy: number
  ms: number
  flick?: SwipeDirection | null
}): SwipeDirection | null {
  const move = dominant(dx, dy)
  if (move && move.along >= SWIPE_DISTANCE) return move.direction
  return flick === undefined ? flickDirection(dx, dy, ms) : flick
}
