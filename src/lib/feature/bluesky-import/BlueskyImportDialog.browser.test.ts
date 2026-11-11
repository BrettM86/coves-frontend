// @vitest-environment jsdom
/**
 * The Bluesky import dialog over a real kit Modal. In the automatic offer
 * every way of closing it records a dismissal; a successful import does not.
 * Opened from settings, closing it never records a dismissal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { XrpcError } from '$lib/api/coves/xrpc'
import type {
  BlueskyProfileImportField,
  ImportBlueskyProfileOutput,
} from '$lib/api/coves/types'
import { toasts } from '$lib/ui/kit/toast/toasts'

type PageState = { openModals?: string[] }

const AVATAR_URL =
  'http://localhost:3001/xrpc/com.atproto.sync.getBlob?did=did:plc:alice&cid=bafkreiavatar'

const mocks = vi.hoisted(() => ({
  api: {
    importBlueskyProfile: vi.fn(),
    getBlueskyProfileImport: vi.fn(),
  },
  dismiss: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
  invalidate: vi.fn(async () => {}),
  clearFeeds: vi.fn(),
  auth: { sessionExpired: false },
  navigation: {
    read: (): PageState => ({}),
    push: (_state: PageState) => {},
    replace: (_state: PageState) => {},
    back: () => {},
  },
}))

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/state', () => ({
  page: {
    get state() {
      return mocks.navigation.read()
    },
    url: new URL('http://localhost/'),
  },
}))
vi.mock('$app/navigation', () => ({
  invalidateAll: mocks.invalidateAll,
  invalidate: mocks.invalidate,
  goto: vi.fn(async () => {}),
  pushState: (_url: string, state: PageState) => mocks.navigation.push(state),
  replaceState: (_url: string, state: PageState) =>
    mocks.navigation.replace(state),
}))
vi.mock('$lib/api/client.svelte', () => ({
  coves: () => mocks.api,
  getClient: vi.fn(),
  site: { data: undefined },
}))
vi.mock('$lib/feature/bluesky-import/dismiss', () => ({
  dismissBlueskyProfileImport: mocks.dismiss,
}))
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: {
    current: { type: 'authenticated', handle: 'alice.test' },
    get sessionExpired() {
      return mocks.auth.sessionExpired
    },
  },
}))
vi.mock('$lib/feature/feeds/feed.svelte', () => ({
  feeds: { clear: mocks.clearFeeds },
}))

const translate = (key: string) => key
vi.mock('$lib/app/state/i18n', () => ({
  t: {
    get: translate,
    subscribe: (run: (translator: typeof translate) => void) => {
      run(translate)
      return () => {}
    },
  },
  locale: {
    set: () => {},
    subscribe: (run: (locale: string) => void) => {
      run('en')
      return () => {}
    },
  },
}))

const svelteClientEntry = async (subpath: string): Promise<unknown> => {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */ require_
      .resolve('svelte/package.json')
      .replace('package.json', subpath)
  )
}
vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))
vi.mock('svelte/reactivity', () =>
  svelteClientEntry('src/reactivity/index-client.js'),
)
vi.mock('svelte/transition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/transition')>()),
  fade: () => ({ duration: 0 }),
  scale: () => ({ duration: 0 }),
}))
vi.mock('svelte-floating-ui', () => ({
  createFloatingActions: () => [
    () => ({ destroy: () => {} }),
    () => ({ update: () => {}, destroy: () => {} }),
  ],
}))
vi.mock('trap-focus-svelte', () => ({
  trapFocus: () => ({ destroy: () => {} }),
}))

const BANNER_URL =
  'http://localhost:3001/xrpc/com.atproto.sync.getBlob?did=did:plc:alice&cid=bafkreibanner'

/**
 * jsdom has no matchMedia, PointerEvent or pointer capture. matchMedia is
 * installed before the dialog module first loads (svelte/motion reads it once
 * at import) and answers from `motion.reduced`, which a test may flip.
 */
const motion = { reduced: false }
window.matchMedia = (query: string) =>
  ({
    media: query,
    get matches() {
      return motion.reduced && query.includes('prefers-reduced-motion')
    },
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    readonly isPrimary: boolean
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 1
      this.pointerType = init.pointerType ?? 'mouse'
      this.isPrimary = init.isPrimary ?? true
    }
  }
  window.PointerEvent = PointerEventShim as unknown as typeof PointerEvent
  globalThis.PointerEvent = window.PointerEvent
}
for (const method of ['setPointerCapture', 'releasePointerCapture'] as const) {
  if (!Element.prototype[method]) Element.prototype[method] = () => {}
}
if (!Element.prototype.hasPointerCapture)
  Element.prototype.hasPointerCapture = () => false

const fields: BlueskyProfileImportField[] = [
  { field: 'displayName', bluesky: 'Alice', covesIsEmpty: false },
  { field: 'description', bluesky: '<b>x</b>', covesIsEmpty: true },
  { field: 'avatar', blueskyImageUrl: AVATAR_URL, covesIsEmpty: true },
]

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')
let onimported: ReturnType<
  typeof vi.fn<(result: ImportBlueskyProfileOutput) => void>
>

beforeEach(async () => {
  client = await import('svelte')
  const { SvelteMap } = await import('svelte/reactivity')
  const current = new SvelteMap<string, PageState>([['state', {}]])
  const history: PageState[] = [{}]
  let index = 0
  mocks.navigation.read = () => current.get('state') ?? {}
  mocks.navigation.push = (state) => {
    history.splice(index + 1)
    history.push(state)
    index++
    current.set('state', state)
  }
  mocks.navigation.replace = (state) => {
    history[index] = state
    current.set('state', state)
  }
  mocks.navigation.back = () => {
    if (index > 0) index--
    current.set('state', history[index] ?? {})
  }
  vi.spyOn(window.history, 'back').mockImplementation(() =>
    mocks.navigation.back(),
  )
  mocks.api.importBlueskyProfile.mockReset().mockResolvedValue({
    uri: 'at://did:plc:alice/social.coves.actor.profile/self',
    cid: 'bafyimported',
    imported: ['description'],
  })
  mocks.dismiss.mockClear()
  mocks.invalidateAll.mockReset().mockImplementation(async () => {})
  mocks.auth.sessionExpired = false
  motion.reduced = false
  mocks.invalidate.mockClear()
  mocks.clearFeeds.mockClear()
  onimported = vi.fn<(result: ImportBlueskyProfileOutput) => void>()
  toasts.set([])
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  toasts.set([])
  target.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function settle() {
  await client.tick()
  client.flushSync()
}

function useFakeTimers(): void {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'Date',
    ],
  })
}

async function mountDialog(
  mode: 'offer' | 'settings',
  dialogFields: BlueskyProfileImportField[] = fields,
) {
  const Dialog = (await import('./BlueskyImportDialog.svelte')).default
  const { SvelteMap } = await import('svelte/reactivity')
  const state = new SvelteMap([['open', true]])
  mounted = client.mount(Dialog, {
    target,
    intro: false,
    props: {
      get open() {
        return state.get('open') ?? false
      },
      set open(value: boolean) {
        state.set('open', value)
      },
      mode,
      fields: dialogFields,
      onimported,
    },
  })
  await settle()
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]')
}

function openDialog(): HTMLElement {
  const found = dialog()
  if (!found) throw new Error('The import dialog is not open')
  return found
}

function checkboxes(): HTMLInputElement[] {
  return [
    ...openDialog().querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    ),
  ]
}

function button(label: string): HTMLButtonElement {
  const found = [
    ...openDialog().querySelectorAll<HTMLButtonElement>('button'),
  ].find((candidate) => candidate.textContent?.trim() === label)
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}

/** A short notice reaches the user as a toast or as text on the page. */
function noticeShown(key: string): boolean {
  return (
    get(toasts).some((entry) => entry.content === key) ||
    (document.body.textContent ?? '').includes(key)
  )
}

const closeWays = {
  Escape: () =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    ),
  'backdrop click': () =>
    openDialog().dispatchEvent(new MouseEvent('click', { bubbles: true })),
  '"No thanks"': () => button('form.profile.blueskyImport.noThanks').click(),
  'browser Back': () => mocks.navigation.back(),
}

describe('BlueskyImportDialog in the automatic offer', () => {
  it('lists the fields empty on Coves, checked, with Bluesky text as literal text and images as <img>', async () => {
    await mountDialog('offer')

    const boxes = checkboxes()
    expect(boxes.map((box) => box.value)).toEqual(['description', 'avatar'])
    expect(boxes.map((box) => box.checked)).toEqual([true, true])
    expect(openDialog().textContent).toContain('<b>x</b>')
    expect(openDialog().querySelector('b')).toBeNull()
    expect(
      [...openDialog().querySelectorAll('img')].map((image) =>
        image.getAttribute('src'),
      ),
    ).toEqual([AVATAR_URL])
  })

  it.each(Object.entries(closeWays))(
    'closing by %s records exactly one dismissal',
    async (_way, close) => {
      await mountDialog('offer')
      expect(dialog()).not.toBeNull()

      close()
      await settle()

      expect(dialog()).toBeNull()
      expect(mocks.dismiss).toHaveBeenCalledTimes(1)
    },
  )

  it('imports only the checked fields, then closes without a dismissal and refreshes the session', async () => {
    await mountDialog('offer')
    const avatar = checkboxes().find((box) => box.value === 'avatar')
    if (!avatar) throw new Error('Missing avatar checkbox')
    avatar.click()
    await settle()
    useFakeTimers()

    button('form.profile.blueskyImport.importProfile').click()
    await vi.advanceTimersByTimeAsync(4000)

    await vi.waitFor(() =>
      expect(mocks.api.importBlueskyProfile).toHaveBeenCalledWith({
        fields: ['description'],
      }),
    )
    await vi.waitFor(() => expect(dialog()).toBeNull())
    await vi.waitFor(() => expect(mocks.invalidateAll).toHaveBeenCalledOnce())
    expect(mocks.clearFeeds).toHaveBeenCalledOnce()
    expect(get(toasts)).toEqual([
      expect.objectContaining({
        content: 'toast.blueskyProfileImported',
        type: 'success',
      }),
    ])
    expect(onimported).toHaveBeenCalledWith({
      uri: 'at://did:plc:alice/social.coves.actor.profile/self',
      cid: 'bafyimported',
      imported: ['description'],
    })
    await settle()
    expect(mocks.dismiss).not.toHaveBeenCalled()
  })

  it('shows a failed import inline and stays open', async () => {
    mocks.api.importBlueskyProfile.mockRejectedValue(
      new XrpcError(429, 'RateLimited', 'slow down'),
    )
    await mountDialog('offer')

    button('form.profile.blueskyImport.importProfile').click()

    await vi.waitFor(() =>
      expect(
        openDialog().querySelector('[role="alert"]')?.textContent?.trim(),
      ).toBeTruthy(),
    )
    expect(mocks.api.importBlueskyProfile).toHaveBeenCalledOnce()
    expect(dialog()).not.toBeNull()
    expect(mocks.invalidateAll).not.toHaveBeenCalled()
    expect(mocks.dismiss).not.toHaveBeenCalled()
  })

  it('closes with a short notice when the server reports NothingToImport', async () => {
    mocks.api.importBlueskyProfile.mockRejectedValue(
      new XrpcError(400, 'NothingToImport', 'nothing to import'),
    )
    await mountDialog('offer')

    button('form.profile.blueskyImport.importProfile').click()

    await vi.waitFor(() => expect(dialog()).toBeNull())
    expect(noticeShown('form.profile.blueskyImport.nothingToImport')).toBe(true)
    await settle()
    expect(mocks.dismiss).not.toHaveBeenCalled()
  })

  it.each(['Escape', 'backdrop click'] as const)(
    'while the import request is pending, %s neither closes the offer nor records a dismissal',
    async (way) => {
      let finishImport!: (result: ImportBlueskyProfileOutput) => void
      mocks.api.importBlueskyProfile.mockImplementation(
        () =>
          new Promise<ImportBlueskyProfileOutput>((resolve) => {
            finishImport = resolve
          }),
      )
      await mountDialog('offer')
      useFakeTimers()

      button('form.profile.blueskyImport.importProfile').click()
      await vi.advanceTimersByTimeAsync(1000)
      await settle()
      expect(mocks.api.importBlueskyProfile).toHaveBeenCalledOnce()

      closeWays[way]()
      await settle()
      expect(dialog()).not.toBeNull()
      expect(mocks.dismiss).not.toHaveBeenCalled()

      finishImport({
        uri: 'at://did:plc:alice/social.coves.actor.profile/self',
        cid: 'bafyimported',
        imported: ['description'],
      } as ImportBlueskyProfileOutput)
      await vi.advanceTimersByTimeAsync(3000)
      await settle()

      expect(dialog()).toBeNull()
      expect(get(toasts)).toEqual([
        expect.objectContaining({
          content: 'toast.blueskyProfileImported',
          type: 'success',
        }),
      ])
      expect(onimported).toHaveBeenCalledWith({
        uri: 'at://did:plc:alice/social.coves.actor.profile/self',
        cid: 'bafyimported',
        imported: ['description'],
      })
      expect(mocks.dismiss).not.toHaveBeenCalled()
    },
  )

  it('during the move, "No thanks" is disabled and the import still goes ahead', async () => {
    await mountDialog('offer')
    useFakeTimers()

    button('form.profile.blueskyImport.importProfile').click()
    await vi.advanceTimersByTimeAsync(200)
    await settle()
    expect(mocks.api.importBlueskyProfile).not.toHaveBeenCalled()

    const noThanks = button('form.profile.blueskyImport.noThanks')
    expect(noThanks.disabled).toBe(true)
    noThanks.click()
    await vi.advanceTimersByTimeAsync(1500)
    await settle()

    expect(mocks.api.importBlueskyProfile).toHaveBeenCalledOnce()
    expect(mocks.dismiss).not.toHaveBeenCalled()
  })

  it('stays open through the seated pause when the refresh resets page.state, as invalidateAll does', async () => {
    mocks.invalidateAll.mockImplementation(async () => {
      mocks.navigation.replace({})
    })
    await mountDialog('offer')
    useFakeTimers()

    button('form.profile.blueskyImport.importProfile').click()
    await vi.advanceTimersByTimeAsync(600)
    await settle()
    expect(mocks.api.importBlueskyProfile).toHaveBeenCalledOnce()
    expect(mocks.invalidateAll).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(2000)
    await settle()
    expect(dialog()).not.toBeNull()
    expect(mocks.dismiss).not.toHaveBeenCalled()
    expect(get(toasts)).toEqual([])

    await vi.advanceTimersByTimeAsync(1000)
    await settle()
    expect(dialog()).toBeNull()
    expect(mocks.dismiss).not.toHaveBeenCalled()
    expect(get(toasts)).toEqual([
      expect.objectContaining({
        content: 'toast.blueskyProfileImported',
        type: 'success',
      }),
    ])
  })
})

describe('BlueskyImportDialog after the import request', () => {
  const imported = {
    uri: 'at://did:plc:alice/social.coves.actor.profile/self',
    cid: 'bafyimported',
    imported: ['description'],
  }

  it('stays open until the session refresh finishes, then closes and reports the result', async () => {
    let finishRefresh!: () => void
    mocks.invalidateAll.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve
        }),
    )
    await mountDialog('settings')
    useFakeTimers()

    button('form.profile.blueskyImport.importProfile').click()
    await vi.advanceTimersByTimeAsync(4000)
    await vi.waitFor(() => expect(mocks.invalidateAll).toHaveBeenCalledOnce())
    await settle()

    expect(dialog()).not.toBeNull()
    expect(onimported).not.toHaveBeenCalled()

    finishRefresh()
    await vi.advanceTimersByTimeAsync(100)
    await vi.waitFor(() => expect(dialog()).toBeNull())
    expect(onimported).toHaveBeenCalledWith(imported)
  })

  it('still closes, toasts and reports the result when the session refresh fails', async () => {
    mocks.invalidateAll.mockRejectedValue(new Error('load failed'))
    await mountDialog('settings')
    useFakeTimers()

    button('form.profile.blueskyImport.importProfile').click()
    await vi.advanceTimersByTimeAsync(4000)

    await vi.waitFor(() => expect(mocks.invalidateAll).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(dialog()).toBeNull())
    await settle()
    expect(get(toasts)).toEqual([
      expect.objectContaining({
        content: 'toast.blueskyProfileImported',
        type: 'success',
      }),
    ])
    expect(onimported).toHaveBeenCalledWith(imported)
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows no inline error for a 401 once the session has expired', async () => {
    mocks.auth.sessionExpired = true
    mocks.api.importBlueskyProfile.mockRejectedValue(
      new XrpcError(401, 'AuthExpired', 'session expired'),
    )
    await mountDialog('settings')

    button('form.profile.blueskyImport.importProfile').click()

    await vi.waitFor(() =>
      expect(mocks.api.importBlueskyProfile).toHaveBeenCalledOnce(),
    )
    await settle()
    await settle()
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })
})

describe('BlueskyImportDialog opened from settings', () => {
  it.each(['Escape', '"No thanks"'] as const)(
    'closing by %s records no dismissal',
    async (way) => {
      await mountDialog('settings')
      expect(dialog()).not.toBeNull()

      closeWays[way]()
      await settle()

      expect(dialog()).toBeNull()
      expect(mocks.dismiss).not.toHaveBeenCalled()
    },
  )
})

/*
 * Drag-to-import. DOM contract these tests assume:
 * - Source card: the element inside the dialog with
 *   aria-label="form.profile.blueskyImport.blueskyLabel" and tabindex="0".
 *   It also shows that key as visible text (the "Bluesky" label), and holds
 *   the field toggles. Its size is read with its own getBoundingClientRect.
 * - Target: role="region" with aria-label="form.profile.blueskyImport.covesTarget",
 *   measured with its own getBoundingClientRect.
 * - Each field toggle is a native <input type="checkbox" value={field}> inside
 *   a <label> that wraps that field's preview. The <label> carries
 *   data-selected="true" | "false" following the checkbox.
 * - Pointer: pointerdown lands on the source card (or a field inside it);
 *   pointermove / pointerup are dispatched on document (outside the card), so
 *   the drag must listen on document or window, not on the card. At rest
 *   (never dragged, sprung back, or rolled back after a failed import) the
 *   card's inline style.transform is '' or 'none'.
 * - Drag ghost: once a drag passes the threshold, a floating copy of the card
 *   is rendered as `document.body > [data-drag-ghost]` (outside the dialog, so
 *   the modal's overflow and backdrop-filter cannot clip it), with
 *   aria-hidden="true", pointer-events none, style.position 'fixed' and
 *   style.left/top at the card's starting rect in px. Its inline
 *   style.transform carries translate(dx, dy) for the pointer delta. While a
 *   ghost exists the source card stays in its slot with inline
 *   style.visibility 'hidden'; otherwise its visibility is '' or 'visible'.
 *   A drop removes the ghost before the import is requested; a spring-back
 *   removes it after animating back; closing mid-drag removes it.
 * - Geometry (fixed stubs): source {top 100, left 0, 300x200}, centre y 200;
 *   target {top 330, left 0, 300x400}, centre y 530. Progress = the card's
 *   displacement toward the target / the distance between the two centres
 *   (330 px). overTarget = the pointer is inside the target rect.
 * - Timing: the move sequence is driven by setTimeout / requestAnimationFrame
 *   (no Web Animations; jsdom has none), so fake timers drive it. The import
 *   request is sent only once the sequence has finished.
 * - Reduced motion is read through matchMedia('(prefers-reduced-motion: reduce)').
 * - Merge progress: while dragging, the ghost's inline style carries the
 *   custom property --merge-progress (read with
 *   style.getPropertyValue('--merge-progress')) as a plain number string
 *   from 0 to 1: mergeProgress(the card's progress toward the target), updated
 *   on each pointer move (rAF-throttling allowed). Under reduced motion it
 *   stays 0 or unset.
 * - Seated pause: once the move lands, the card sits in the slot as a mirror
 *   of the Coves profile header, an element with [data-seated] inside the
 *   Coves target region, showing the imported name, '@' + handle, bio as
 *   literal text and an <img> per selected image field. The import request is
 *   sent while it is shown. The dialog closes only once both the pause
 *   (seatPauseMs) has elapsed and the import and refresh have finished; a
 *   failed import removes it and rolls the card back.
 * - Seat burst: the moment [data-seated] appears (after a drop, the button or
 *   Enter), a burst of outline confetti fires out of the card's left and right
 *   sides as a single overlay `document.body > [data-seat-burst]`, with
 *   aria-hidden="true", pointer-events none and position fixed above the
 *   dialog, holding the particles as child elements (at least 8 per side, 16+
 *   in all). It is removed once the burst ends, no later than 1500 ms after
 *   seating. Under reduced motion no burst is created. Closing the dialog
 *   removes any burst immediately.
 */
describe('BlueskyImportDialog drag to import', () => {
  const SOURCE_RECT = { top: 100, left: 0, width: 300, height: 200 }
  const TARGET_RECT = { top: 330, left: 0, width: 300, height: 400 }

  const allFields: BlueskyProfileImportField[] = [
    { field: 'displayName', bluesky: 'Alice', covesIsEmpty: false },
    { field: 'description', bluesky: '<b>x</b>', covesIsEmpty: true },
    { field: 'avatar', blueskyImageUrl: AVATAR_URL, covesIsEmpty: true },
    { field: 'banner', blueskyImageUrl: BANNER_URL, covesIsEmpty: false },
  ]

  function sourceCard(): HTMLElement {
    const found = openDialog().querySelector<HTMLElement>(
      '[aria-label="form.profile.blueskyImport.blueskyLabel"]',
    )
    if (!found) throw new Error('Missing the Bluesky source card')
    return found
  }

  function covesTarget(): HTMLElement {
    const found = openDialog().querySelector<HTMLElement>(
      '[role="region"][aria-label="form.profile.blueskyImport.covesTarget"]',
    )
    if (!found) throw new Error('Missing the Coves target region')
    return found
  }

  function fixRect(
    element: HTMLElement,
    rect: { top: number; left: number; width: number; height: number },
  ): void {
    element.getBoundingClientRect = () =>
      ({
        ...rect,
        x: rect.left,
        y: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        toJSON: () => rect,
      }) as DOMRect
  }

  function stubGeometry(): void {
    fixRect(sourceCard(), SOURCE_RECT)
    fixRect(covesTarget(), TARGET_RECT)
  }

  function cardAtRest(): boolean {
    const transform = sourceCard().style.transform
    return transform === '' || transform === 'none'
  }

  function ghosts(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[data-drag-ghost]')]
  }

  function cardVisible(card: HTMLElement = sourceCard()): boolean {
    const visibility = card.style.visibility
    return visibility === '' || visibility === 'visible'
  }

  function fieldBox(field: string): HTMLInputElement {
    const found = sourceCard().querySelector<HTMLInputElement>(
      `input[type="checkbox"][value="${field}"]`,
    )
    if (!found) throw new Error(`Missing ${field} toggle on the source card`)
    return found
  }

  function fieldPreview(field: string): HTMLLabelElement {
    const found = fieldBox(field).closest('label')
    if (!found) throw new Error(`The ${field} toggle has no wrapping label`)
    return found
  }

  function pointer(
    on: EventTarget,
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    x: number,
    y: number,
    pointerType = 'mouse',
    buttons = type === 'pointerup' ? 0 : 1,
  ): void {
    on.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType,
        isPrimary: true,
        button: 0,
        buttons,
      }),
    )
  }

  /** Press on `from`, move via the midpoint to the end, release outside the card. */
  function drag(
    from: EventTarget,
    start: [number, number],
    end: [number, number],
    pointerType = 'mouse',
  ): void {
    pointer(from, 'pointerdown', start[0], start[1], pointerType)
    const mid: [number, number] = [
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2,
    ]
    pointer(document, 'pointermove', mid[0], mid[1], pointerType)
    pointer(document, 'pointermove', end[0], end[1], pointerType)
    pointer(document, 'pointerup', end[0], end[1], pointerType)
  }

  async function uncheck(field: string): Promise<void> {
    const box = checkboxes().find((candidate) => candidate.value === field)
    if (!box) throw new Error(`Missing ${field} checkbox`)
    if (box.checked) box.click()
    await settle()
  }

  function accessibleName(element: HTMLElement): string {
    const labelled = element.getAttribute('aria-labelledby')
    return (
      element.getAttribute('aria-label') ??
      (labelled
        ? labelled
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ')
        : [...((element as HTMLInputElement).labels ?? [])]
            .map((label) => label.textContent ?? '')
            .join(' '))
    ).trim()
  }

  // Release points (pointer starts on the card):
  // inside the target with little progress, outside it past half way, short.
  const releases = {
    'released inside the target': {
      start: [150, 290],
      end: [150, 340],
      imports: true,
    },
    'released outside the target past half way': {
      start: [150, 150],
      end: [150, 325],
      imports: true,
    },
    'released short of half way outside the target': {
      start: [150, 150],
      end: [150, 210],
      imports: false,
    },
  } as const

  describe.each(['mouse', 'touch'])('with a %s pointer', (pointerType) => {
    it.each(Object.entries(releases).filter(([, r]) => r.imports))(
      '%s imports the checked fields and closes without a dismissal',
      async (_case, release) => {
        await mountDialog('offer')
        await uncheck('avatar')
        stubGeometry()
        useFakeTimers()

        drag(sourceCard(), [...release.start], [...release.end], pointerType)
        await vi.advanceTimersByTimeAsync(1000)

        await vi.waitFor(() =>
          expect(mocks.api.importBlueskyProfile).toHaveBeenCalledWith({
            fields: ['description'],
          }),
        )
        expect(mocks.api.importBlueskyProfile).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(3500)
        await vi.waitFor(() => expect(dialog()).toBeNull())
        expect(mocks.dismiss).not.toHaveBeenCalled()
      },
    )

    it.each(Object.entries(releases).filter(([, r]) => !r.imports))(
      '%s springs back without importing',
      async (_case, release) => {
        await mountDialog('offer')
        stubGeometry()
        useFakeTimers()

        drag(sourceCard(), [...release.start], [...release.end], pointerType)
        await vi.advanceTimersByTimeAsync(1000)
        await settle()

        expect(mocks.api.importBlueskyProfile).not.toHaveBeenCalled()
        expect(dialog()).not.toBeNull()
        expect(cardAtRest()).toBe(true)
        expect(mocks.dismiss).not.toHaveBeenCalled()
      },
    )
  })

  const triggers = {
    'a drop on the target': () => drag(sourceCard(), [150, 290], [150, 340]),
    'the Import profile button': () =>
      button('form.profile.blueskyImport.importProfile').click(),
    'Enter on the card': () => {
      sourceCard().focus()
      sourceCard().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      )
    },
  }

  it.each(Object.entries(triggers))(
    'after %s the import waits for the move to finish',
    async (_trigger, trigger) => {
      await mountDialog('offer')
      stubGeometry()
      useFakeTimers()

      trigger()
      await settle()
      await vi.advanceTimersByTimeAsync(350)
      expect(mocks.api.importBlueskyProfile).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(650)
      expect(mocks.api.importBlueskyProfile).toHaveBeenCalledWith({
        fields: ['description', 'avatar'],
      })
    },
  )

  it('with reduced motion still imports, after a crossfade of at most 200 ms', async () => {
    motion.reduced = true
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()

    button('form.profile.blueskyImport.importProfile').click()
    await settle()
    expect(mocks.api.importBlueskyProfile).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)
    expect(mocks.api.importBlueskyProfile).toHaveBeenCalledWith({
      fields: ['description', 'avatar'],
    })
  })

  it('a tap on a field toggles it', async () => {
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()
    const preview = fieldPreview('avatar')

    pointer(preview, 'pointerdown', 150, 150)
    pointer(preview, 'pointerup', 150, 150)
    preview.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    await settle()

    expect(fieldBox('avatar').checked).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.api.importBlueskyProfile).not.toHaveBeenCalled()
  })

  it('a drag that starts on a field and comes back near its start leaves the field unchanged', async () => {
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()
    const preview = fieldPreview('avatar')

    pointer(preview, 'pointerdown', 150, 150)
    pointer(document, 'pointermove', 150, 170)
    pointer(document, 'pointermove', 150, 152)
    pointer(document, 'pointerup', 150, 152)
    preview.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    await settle()

    expect(fieldBox('avatar').checked).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.api.importBlueskyProfile).not.toHaveBeenCalled()
    expect(cardAtRest()).toBe(true)
  })

  it('the card takes keyboard focus and has an accessible name', async () => {
    await mountDialog('offer')
    const card = sourceCard()

    expect(card.getAttribute('tabindex')).toBe('0')
    card.focus()
    expect(document.activeElement).toBe(card)
    expect(accessibleName(card)).toBe('form.profile.blueskyImport.blueskyLabel')
  })

  it.each([
    ['Enter', 'Enter'],
    ['Space', ' '],
  ])(
    '%s on the focused card imports the checked fields',
    async (_name, key) => {
      await mountDialog('offer')
      await uncheck('avatar')
      stubGeometry()
      useFakeTimers()
      const card = sourceCard()

      card.focus()
      card.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      )
      card.dispatchEvent(
        new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }),
      )
      await vi.advanceTimersByTimeAsync(1000)

      await vi.waitFor(() =>
        expect(mocks.api.importBlueskyProfile).toHaveBeenCalledWith({
          fields: ['description'],
        }),
      )
    },
  )

  it('Space on a focused field toggle toggles that field and does not import', async () => {
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()
    const box = fieldBox('avatar')

    box.focus()
    box.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: ' ',
        bubbles: true,
        cancelable: true,
      }),
    )
    box.dispatchEvent(
      new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }),
    )
    box.click()
    await settle()
    await vi.advanceTimersByTimeAsync(1000)

    expect(box.checked).toBe(false)
    expect(mocks.api.importBlueskyProfile).not.toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
  })

  it('with no field checked, Import profile is disabled and a drag onto the target springs back', async () => {
    await mountDialog('offer')
    await uncheck('description')
    await uncheck('avatar')
    stubGeometry()
    useFakeTimers()

    expect(button('form.profile.blueskyImport.importProfile').disabled).toBe(
      true,
    )

    drag(sourceCard(), [150, 150], [150, 400])
    await vi.advanceTimersByTimeAsync(1000)
    await settle()

    expect(mocks.api.importBlueskyProfile).not.toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
    expect(cardAtRest()).toBe(true)
  })

  it('shows the Bluesky profile as a labelled card above a labelled Coves target', async () => {
    await mountDialog('settings', allFields)
    const card = sourceCard()

    expect(card.textContent).toContain(
      'form.profile.blueskyImport.blueskyLabel',
    )
    expect(
      [...card.querySelectorAll('img')]
        .map((image) => image.getAttribute('src'))
        .sort(),
    ).toEqual([AVATAR_URL, BANNER_URL].sort())
    expect(card.textContent).toContain('Alice')
    expect(card.textContent).toContain('@alice.test')
    expect(card.textContent).toContain('<b>x</b>')
    expect(covesTarget()).not.toBeNull()

    const names = ['displayName', 'description', 'avatar', 'banner'].map(
      (field) => accessibleName(fieldBox(field)),
    )
    expect(names[0]).toContain('form.profile.displayName')
    expect(names[1]).toContain('form.profile.bio')
    expect(names[2]).toContain('form.profile.avatar')
    expect(names[3]).toContain('form.profile.banner')
  })

  it('shows the Bluesky bio with runs of blank lines collapsed to one line break', async () => {
    await mountDialog('settings', [
      { field: 'description', bluesky: 'one\n\n\ntwo', covesIsEmpty: true },
    ])

    const bio = [
      ...fieldPreview('description').querySelectorAll<HTMLElement>('*'),
    ].find(
      (element) =>
        element.children.length === 0 &&
        (element.textContent ?? '').includes('one'),
    )
    if (!bio) throw new Error('Missing the Bluesky bio text')
    expect(bio.textContent?.trim()).toBe('one\ntwo')
  })

  it('names each field toggle by its label alone, without the Bluesky value', async () => {
    await mountDialog('settings', allFields)

    expect(
      ['displayName', 'description', 'avatar', 'banner'].map((field) =>
        accessibleName(fieldBox(field)),
      ),
    ).toEqual([
      'form.profile.displayName',
      'form.profile.bio',
      'form.profile.avatar',
      'form.profile.banner',
    ])
  })

  it('closing the offer mid-drag records one dismissal and a later release over the target does not import', async () => {
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()

    pointer(sourceCard(), 'pointerdown', 150, 150)
    pointer(document, 'pointermove', 150, 200)
    closeWays.Escape()
    await settle()
    pointer(document, 'pointermove', 150, 400)
    pointer(document, 'pointerup', 150, 400)
    await vi.advanceTimersByTimeAsync(1500)
    await settle()

    expect(mocks.api.importBlueskyProfile).not.toHaveBeenCalled()
    expect(mocks.dismiss).toHaveBeenCalledOnce()
  })

  it('a move with no button held ends the drag as a cancel, and a later release over the target does not import', async () => {
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()

    pointer(sourceCard(), 'pointerdown', 150, 150)
    pointer(document, 'pointermove', 150, 200)
    pointer(document, 'pointermove', 150, 400, 'mouse', 0)
    await settle()
    expect(cardAtRest()).toBe(true)

    pointer(document, 'pointerup', 150, 400)
    covesTarget().dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    await vi.advanceTimersByTimeAsync(1500)
    await settle()

    expect(mocks.api.importBlueskyProfile).not.toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
    expect(cardAtRest()).toBe(true)
  })

  it('while dragging, a ghost of the card floats on document.body at the card rect and the card is hidden in its slot', async () => {
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()

    pointer(sourceCard(), 'pointerdown', 150, 150)
    pointer(document, 'pointermove', 150, 210)
    await settle()

    const found = ghosts()
    expect(found).toHaveLength(1)
    const ghost = found[0]
    expect(ghost.parentElement).toBe(document.body)
    expect(openDialog().contains(ghost)).toBe(false)
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
    expect(ghost.style.position).toBe('fixed')
    expect(ghost.style.pointerEvents).toBe('none')
    expect(ghost.style.left).toBe('0px')
    expect(ghost.style.top).toBe('100px')
    expect(ghost.style.transform).toContain('translate(0px, 60px)')
    expect(sourceCard().style.visibility).toBe('hidden')
  })

  it('a spring-back removes the ghost and leaves the card visible and at rest', async () => {
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()

    pointer(sourceCard(), 'pointerdown', 150, 150)
    pointer(document, 'pointermove', 150, 210)
    await settle()
    expect(ghosts()).toHaveLength(1)

    pointer(document, 'pointerup', 150, 210)
    await vi.advanceTimersByTimeAsync(1000)
    await settle()

    expect(ghosts()).toHaveLength(0)
    expect(cardVisible()).toBe(true)
    expect(cardAtRest()).toBe(true)
    expect(mocks.api.importBlueskyProfile).not.toHaveBeenCalled()
  })

  it('a drop removes the ghost and shows the card before the import is requested', async () => {
    const atRequest: { ghosts: number; cardVisible: boolean }[] = []
    mocks.api.importBlueskyProfile.mockImplementation(async () => {
      atRequest.push({ ghosts: ghosts().length, cardVisible: cardVisible() })
      return {
        uri: 'at://did:plc:alice/social.coves.actor.profile/self',
        cid: 'bafyimported',
        imported: ['description'],
      }
    })
    await mountDialog('offer')
    await uncheck('avatar')
    stubGeometry()
    useFakeTimers()

    pointer(sourceCard(), 'pointerdown', 150, 290)
    pointer(document, 'pointermove', 150, 340)
    await settle()
    expect(ghosts()).toHaveLength(1)

    pointer(document, 'pointerup', 150, 340)
    await vi.advanceTimersByTimeAsync(1000)

    await vi.waitFor(() =>
      expect(mocks.api.importBlueskyProfile).toHaveBeenCalledWith({
        fields: ['description'],
      }),
    )
    expect(atRequest).toEqual([{ ghosts: 0, cardVisible: true }])
  })

  it('closing the offer mid-drag removes the ghost', async () => {
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()

    pointer(sourceCard(), 'pointerdown', 150, 150)
    pointer(document, 'pointermove', 150, 210)
    await settle()
    expect(ghosts()).toHaveLength(1)

    closeWays.Escape()
    await settle()
    await vi.advanceTimersByTimeAsync(1000)
    await settle()

    expect(ghosts()).toHaveLength(0)
  })

  it('a release past half way imports even when the last move was short of it', async () => {
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()

    pointer(sourceCard(), 'pointerdown', 150, 150)
    pointer(document, 'pointermove', 150, 200)
    pointer(document, 'pointerup', 150, 325)
    await vi.advanceTimersByTimeAsync(1000)

    await vi.waitFor(() =>
      expect(mocks.api.importBlueskyProfile).toHaveBeenCalledWith({
        fields: ['description', 'avatar'],
      }),
    )
  })

  it('a release back near the start springs back even when the last move was inside the target past half way', async () => {
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()

    pointer(sourceCard(), 'pointerdown', 150, 150)
    pointer(document, 'pointermove', 150, 340)
    pointer(document, 'pointerup', 150, 160)
    await vi.advanceTimersByTimeAsync(1000)
    await settle()

    expect(mocks.api.importBlueskyProfile).not.toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
    expect(cardAtRest()).toBe(true)
  })

  it('marks an unchecked field as deselected and a checked one as selected', async () => {
    await mountDialog('settings', allFields)

    expect(
      ['displayName', 'description', 'avatar', 'banner'].map((field) =>
        fieldPreview(field).getAttribute('data-selected'),
      ),
    ).toEqual(['false', 'true', 'true', 'false'])

    fieldBox('displayName').click()
    await settle()
    expect(fieldPreview('displayName').getAttribute('data-selected')).toBe(
      'true',
    )
  })

  it('after a failed import from a drop the card is back, the controls work and the error shows', async () => {
    mocks.api.importBlueskyProfile.mockRejectedValue(
      new XrpcError(429, 'RateLimited', 'slow down'),
    )
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()

    drag(sourceCard(), [150, 290], [150, 340])
    await vi.advanceTimersByTimeAsync(1000)

    await vi.waitFor(() =>
      expect(
        openDialog().querySelector('[role="alert"]')?.textContent?.trim(),
      ).toBeTruthy(),
    )
    await vi.advanceTimersByTimeAsync(1000)
    await settle()
    expect(mocks.api.importBlueskyProfile).toHaveBeenCalledOnce()
    expect(cardAtRest()).toBe(true)
    expect(button('form.profile.blueskyImport.importProfile').disabled).toBe(
      false,
    )
    expect(dialog()).not.toBeNull()
    expect(mocks.dismiss).not.toHaveBeenCalled()
  })

  function seated(): HTMLElement | null {
    return covesTarget().querySelector<HTMLElement>('[data-seated]')
  }

  function mergeValue(ghost: HTMLElement): string {
    return ghost.style.getPropertyValue('--merge-progress').trim()
  }

  async function nextFrame(): Promise<void> {
    await vi.advanceTimersByTimeAsync(20)
    await settle()
  }

  it('while dragging, the ghost blends toward Coves by its progress to the slot, and back', async () => {
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()

    pointer(sourceCard(), 'pointerdown', 150, 150)
    pointer(document, 'pointermove', 150, 315)
    await nextFrame()
    const ghost = ghosts()[0]
    if (!ghost) throw new Error('No drag ghost')
    expect(Number(mergeValue(ghost))).toBe(0.5)

    pointer(document, 'pointermove', 150, 480)
    await nextFrame()
    expect(Number(mergeValue(ghost))).toBe(1)

    pointer(document, 'pointermove', 150, 150)
    await nextFrame()
    expect(Number(mergeValue(ghost))).toBe(0)
  })

  it('with reduced motion the ghost does not blend while dragging', async () => {
    motion.reduced = true
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()

    pointer(sourceCard(), 'pointerdown', 150, 150)
    pointer(document, 'pointermove', 150, 315)
    pointer(document, 'pointermove', 150, 480)
    await nextFrame()

    const ghost = ghosts()[0]
    if (!ghost) throw new Error('No drag ghost')
    expect(Number(mergeValue(ghost))).toBe(0)
  })

  it('after a drop the card sits in the slot as the Coves header while the import runs, then closes', async () => {
    const seatedAtRequest: boolean[] = []
    mocks.api.importBlueskyProfile.mockImplementation(async () => {
      seatedAtRequest.push(seated() !== null)
      return {
        uri: 'at://did:plc:alice/social.coves.actor.profile/self',
        cid: 'bafyimported',
        imported: ['displayName', 'description', 'avatar'],
      }
    })
    await mountDialog('settings', allFields)
    fieldBox('displayName').click()
    await settle()
    stubGeometry()
    useFakeTimers()

    drag(sourceCard(), [150, 290], [150, 340])
    await vi.advanceTimersByTimeAsync(1000)
    await settle()

    expect(mocks.api.importBlueskyProfile).toHaveBeenCalledWith({
      fields: ['displayName', 'description', 'avatar'],
    })
    expect(seatedAtRequest).toEqual([true])
    expect(mocks.invalidateAll).toHaveBeenCalledOnce()
    const mirror = seated()
    if (!mirror) throw new Error('No seated Coves header in the slot')
    expect(mirror.textContent).toContain('Alice')
    expect(mirror.textContent).toContain('@alice.test')
    expect(mirror.textContent).toContain('<b>x</b>')
    expect(mirror.querySelector('b')).toBeNull()
    expect(
      [...mirror.querySelectorAll('img')].map((image) =>
        image.getAttribute('src'),
      ),
    ).toEqual([AVATAR_URL])

    await vi.advanceTimersByTimeAsync(1000)
    await settle()
    expect(dialog()).not.toBeNull()
    expect(onimported).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2000)
    await settle()
    expect(dialog()).toBeNull()
    expect(onimported).toHaveBeenCalledWith({
      uri: 'at://did:plc:alice/social.coves.actor.profile/self',
      cid: 'bafyimported',
      imported: ['displayName', 'description', 'avatar'],
    })
    expect(get(toasts)).toEqual([
      expect.objectContaining({
        content: 'toast.blueskyProfileImported',
        type: 'success',
      }),
    ])
  })

  it('an import failure during the seated pause rolls the card back and shows the error', async () => {
    let fail!: (error: unknown) => void
    mocks.api.importBlueskyProfile.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject
        }),
    )
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()

    drag(sourceCard(), [150, 290], [150, 340])
    await vi.advanceTimersByTimeAsync(1000)
    await settle()
    expect(mocks.api.importBlueskyProfile).toHaveBeenCalledOnce()
    expect(seated()).not.toBeNull()

    fail(new XrpcError(429, 'RateLimited', 'slow down'))
    await vi.advanceTimersByTimeAsync(1000)
    await settle()

    expect(seated()).toBeNull()
    expect(cardAtRest()).toBe(true)
    expect(cardVisible()).toBe(true)
    expect(
      openDialog().querySelector('[role="alert"]')?.textContent?.trim(),
    ).toBeTruthy()
    expect(button('form.profile.blueskyImport.importProfile').disabled).toBe(
      false,
    )
    expect(dialog()).not.toBeNull()
    expect(mocks.dismiss).not.toHaveBeenCalled()
  })

  it('with reduced motion the seated pause is short: the dialog closes within 1500 ms of Import profile', async () => {
    const seatedAtRequest: boolean[] = []
    mocks.api.importBlueskyProfile.mockImplementation(async () => {
      seatedAtRequest.push(seated() !== null)
      return {
        uri: 'at://did:plc:alice/social.coves.actor.profile/self',
        cid: 'bafyimported',
        imported: ['description'],
      }
    })
    motion.reduced = true
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()

    button('form.profile.blueskyImport.importProfile').click()
    await vi.advanceTimersByTimeAsync(1500)
    await settle()

    expect(seatedAtRequest).toEqual([true])
    expect(dialog()).toBeNull()
    expect(onimported).toHaveBeenCalledOnce()
  })

  function seatBursts(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[data-seat-burst]')]
  }

  /** Step fake time until the card seats in the slot (at most 1500 ms). */
  async function advanceUntilSeated(): Promise<void> {
    for (let elapsed = 0; elapsed < 1500; elapsed += 10) {
      if (seated()) return
      await vi.advanceTimersByTimeAsync(10)
      await settle()
    }
    if (!seated()) throw new Error('The card never seated in the slot')
  }

  it('when a dropped card seats, one confetti burst fires on document.body and is gone within 1500 ms', async () => {
    mocks.api.importBlueskyProfile.mockImplementation(
      () => new Promise(() => {}),
    )
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()

    drag(sourceCard(), [150, 290], [150, 340])
    await advanceUntilSeated()

    const bursts = seatBursts()
    expect(bursts).toHaveLength(1)
    const burst = bursts[0]!
    expect(burst.parentElement).toBe(document.body)
    expect(burst.getAttribute('aria-hidden')).toBe('true')
    expect(burst.children.length).toBeGreaterThanOrEqual(16)

    await vi.advanceTimersByTimeAsync(1500)
    await settle()
    expect(seatBursts()).toHaveLength(0)
  })

  it('with reduced motion the card seats without a confetti burst', async () => {
    mocks.api.importBlueskyProfile.mockImplementation(
      () => new Promise(() => {}),
    )
    motion.reduced = true
    await mountDialog('offer')
    stubGeometry()
    useFakeTimers()

    button('form.profile.blueskyImport.importProfile').click()
    await advanceUntilSeated()
    expect(seatBursts()).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1500)
    await settle()
    expect(seatBursts()).toHaveLength(0)
  })
})
