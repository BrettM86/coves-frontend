import type { Attachment } from 'svelte/attachments'
import {
  classifySwipe,
  swipeRelease,
  type SwipeDirection,
  type SwipeRelease,
  type SwipeSample,
} from '$lib/app/util/swipe'

/** How long after a recognised swipe's release its trailing click may come. */
const CLICK_AFTER_SWIPE_MS = 400

export interface SwipeOptions {
  /** A recognised swipe, on release. */
  onswipe?: (direction: SwipeDirection, release: SwipeRelease) => void
  /**
   * The tracked finger lifted; called before any onswipe. Return true to
   * swallow the click that follows, as after a recognised swipe.
   */
  onrelease?: (release: SwipeRelease) => boolean

  /** The tracked finger moved; offsets are from where it landed. */
  onmove?: (dx: number, dy: number) => void
  /** Tracking ended: released (after any onswipe), cancelled, or a second finger. */
  onend?: () => void
}

/**
 * Recognises a one-finger touch swipe on the element. Mouse and pen are
 * ignored, as is a touch on a pinch-zoomed page, so the zoomed view pans. A
 * second finger anywhere on the page, pointercancel or lostpointercapture
 * drops the gesture, and
 * a click the browser fires right after a recognised swipe is swallowed so it
 * reaches no handler inside the element.
 */
export function swipe(options: SwipeOptions): Attachment<HTMLElement> {
  return (node) => {
    /** Touch contacts currently down on the element. */
    const contacts = new Set<number>()
    /** The tracked finger and where it has been, landing first. */
    let tracked: {
      id: number
      samples: [SwipeSample, ...SwipeSample[]]
    } | null = null
    /**
     * Until when (performance.now()) a click counts as the one following the
     * last recognised swipe. Comparing times, not a flag, keeps a swipe that
     * sent no click from swallowing a later, unrelated one.
     */
    let swallowClickUntil = -Infinity

    function end(): void {
      tracked = null
      document.removeEventListener('pointerdown', onpagepointerdown, {
        capture: true,
      })
      options.onend?.()
    }

    /** A second finger landing anywhere on the page cancels the gesture. */
    function onpagepointerdown(event: PointerEvent): void {
      if (event.pointerType !== 'touch') return
      if (tracked && event.pointerId !== tracked.id) end()
    }

    function onpointerdown(event: PointerEvent): void {
      swallowClickUntil = -Infinity
      if (event.pointerType !== 'touch') return
      // A primary touch means no other finger is down: any contact still
      // recorded lost its pointerup, as when its target re-rendered.
      if (event.isPrimary !== false) {
        contacts.clear()
        if (tracked) end()
      }
      contacts.add(event.pointerId)
      // A finger already down elsewhere makes this one non-primary: that is a
      // multi-touch gesture, not a swipe.
      if (contacts.size === 1 && event.isPrimary !== false) {
        if ((window.visualViewport?.scale ?? 1) > 1) return
        document.addEventListener('pointerdown', onpagepointerdown, {
          capture: true,
        })
        tracked = { id: event.pointerId, samples: [sample(event)] }
      } else if (tracked) {
        end()
      }
    }

    function sample(event: PointerEvent): SwipeSample {
      return { x: event.clientX, y: event.clientY, time: event.timeStamp }
    }

    function onpointermove(event: PointerEvent): void {
      if (event.pointerId !== tracked?.id) return
      const [start] = tracked.samples
      tracked.samples.push(sample(event))
      options.onmove?.(event.clientX - start.x, event.clientY - start.y)
    }

    function onpointerup(event: PointerEvent): void {
      contacts.delete(event.pointerId)
      if (event.pointerId !== tracked?.id) return
      try {
        const release = swipeRelease([...tracked.samples, sample(event)])
        const swallow = options.onrelease?.(release) ?? false
        const direction = classifySwipe(release)
        if (direction || swallow)
          swallowClickUntil = performance.now() + CLICK_AFTER_SWIPE_MS
        if (direction) options.onswipe?.(direction, release)
      } finally {
        end()
      }
    }

    function onpointercancel(event: PointerEvent): void {
      contacts.delete(event.pointerId)
      if (event.pointerId === tracked?.id) end()
    }

    function onclick(event: MouseEvent): void {
      if (performance.now() > swallowClickUntil) return
      swallowClickUntil = -Infinity
      event.stopPropagation()
      event.preventDefault()
    }

    node.addEventListener('pointerdown', onpointerdown)
    node.addEventListener('pointermove', onpointermove)
    node.addEventListener('pointerup', onpointerup)
    node.addEventListener('pointercancel', onpointercancel)
    node.addEventListener('lostpointercapture', onpointercancel)
    node.addEventListener('click', onclick, { capture: true })
    return () => {
      if (tracked) end()
      node.removeEventListener('pointerdown', onpointerdown)
      node.removeEventListener('pointermove', onpointermove)
      node.removeEventListener('pointerup', onpointerup)
      node.removeEventListener('pointercancel', onpointercancel)
      node.removeEventListener('lostpointercapture', onpointercancel)
      node.removeEventListener('click', onclick, { capture: true })
    }
  }
}
