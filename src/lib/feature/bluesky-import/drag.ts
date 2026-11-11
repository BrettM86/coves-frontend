/** How the Bluesky card reaches the Coves slot once a move is triggered. */
export type MovePlan =
  | {
      kind: 'crossfade'
      durationMs: number
      fieldDelaysMs: number[]
      fieldRevealMs: number
    }
  | {
      kind: 'morph'
      durationMs: number
      fieldDelaysMs: number[]
      /** How long each field takes to fill in once its delay has passed. */
      fieldRevealMs: number
    }

export type DropDecision = 'drop' | 'return'

/** Pointer travel, in CSS pixels, below which a press is a tap. */
const DRAG_THRESHOLD_PX = 6

/** A press becomes a drag once the pointer has travelled the threshold. */
export function isDragGesture(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX
}

/**
 * `progress` is the card's travel toward the target as a fraction of the
 * distance between the two centres; negative when dragged away from it.
 */
export function dropDecision(input: {
  progress: number
  overTarget: boolean
}): DropDecision {
  return input.overTarget || input.progress >= 0.5 ? 'drop' : 'return'
}

/**
 * The morph moves the card into the slot and fills the Coves card's field
 * slots (banner, avatar, name, bio) one after another; with reduced motion
 * the two cards only crossfade.
 */
export function movePlan(reducedMotion: boolean): MovePlan {
  if (reducedMotion)
    return {
      kind: 'crossfade',
      durationMs: 150,
      fieldDelaysMs: [],
      fieldRevealMs: 0,
    }
  return {
    kind: 'morph',
    durationMs: 560,
    fieldDelaysMs: [180, 240, 300, 360],
    fieldRevealMs: 200,
  }
}

/**
 * How far the dragged card has blended from Bluesky to Coves styling, from
 * its travel toward the slot as a fraction of the distance to it.
 */
export function mergeProgress(fraction: number): number {
  const t = Math.min(1, Math.max(0, fraction))
  return t * t * (3 - 2 * t)
}

/** How long the card sits in the slot as a Coves header before closing. */
export function seatPauseMs(reducedMotion: boolean): number {
  return reducedMotion ? 600 : 2700
}
