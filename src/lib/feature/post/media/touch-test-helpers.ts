import { afterEach, beforeEach, vi } from 'vitest'

export type Point = [number, number]

export interface PointerOptions {
  at: Point
  pointerType?: string
  pointerId?: number
  /** Defaults to whether pointerId is 1, the first contact. */
  isPrimary?: boolean
}

export interface SwipeOptions {
  from: Point
  to: Point
  ms?: number
  pointerType?: string
  pointerId?: number
  isPrimary?: boolean
}

/**
 * Stands in for window.visualViewport at `scale` (above 1: pinch-zoomed) for
 * each test of the describe it is called in. It is a real EventTarget, as
 * the browser's is, so `resize` listeners attach.
 */
export function useVisualViewport(scale: number): void {
  let saved: PropertyDescriptor | undefined
  beforeEach(() => {
    saved = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    const viewport = Object.assign(new EventTarget(), { scale })
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: viewport,
    })
  })
  afterEach(() => {
    if (saved) Object.defineProperty(window, 'visualViewport', saved)
    else Reflect.deleteProperty(window, 'visualViewport')
  })
}

/**
 * jsdom 22 has no PointerEvent. Call inside a describe: it fakes the clock
 * that timeStamp and performance.now() report, and restores it after each
 * test.
 */
export function useTouchEnvironment(): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })
}

/**
 * Pointer events built from MouseEvent; `flush` runs after each dispatch so
 * the DOM reflects it (pass the Svelte client's flushSync).
 */
export function touchDriver(flush: () => void) {
  function pointer(
    element: Element,
    type: string,
    {
      at: [x, y],
      pointerType = 'touch',
      pointerId = 1,
      isPrimary = pointerId === 1,
    }: PointerOptions,
  ): void {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    })
    for (const [key, value] of Object.entries({
      pointerType,
      pointerId,
      isPrimary,
      timeStamp: performance.now(),
    })) {
      Object.defineProperty(event, key, { value })
    }
    element.dispatchEvent(event)
    flush()
  }

  /** Lands at `from` and moves toward `to` over `ms`, through the midpoint, without lifting. */
  function drag(
    element: Element,
    { from, to, ms = 200, pointerType, pointerId, isPrimary }: SwipeOptions,
  ): void {
    const options = { pointerType, pointerId, isPrimary }
    const middle: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
    pointer(element, 'pointerdown', { at: from, ...options })
    vi.advanceTimersByTime(ms / 2)
    pointer(element, 'pointermove', { at: middle, ...options })
    vi.advanceTimersByTime(ms / 2)
    pointer(element, 'pointermove', { at: to, ...options })
  }

  /** One contact from `from` to `to` over `ms`, passing through the midpoint. */
  function swipe(element: Element, options: SwipeOptions): void {
    drag(element, options)
    const { to, pointerType, pointerId, isPrimary } = options
    pointer(element, 'pointerup', { at: to, pointerType, pointerId, isPrimary })
  }

  return { pointer, drag, swipe }
}
