import { replaceState } from '$app/navigation'
import { page } from '$app/state'

interface FeedPageSnapshot {
  state: App.PageState
  url: string
}

const FEED_SCROLL_RESTORE_DEADLINE_MS = 500
const ANCHOR_STABLE_DURATION_MS = 100
const POSITION_TOLERANCE_PX = 1

function currentPage(): FeedPageSnapshot {
  return {
    state: page.state ?? {},
    url: `${page.url.pathname}${page.url.search}${page.url.hash}`,
  }
}

function findReturnAnchor(
  root: Element,
  saved: NonNullable<NonNullable<App.PageState['postFeedOrigin']>['anchor']>,
): HTMLAnchorElement | undefined {
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (link.getAttribute('href') !== saved.href) continue
    if (
      link.closest<HTMLElement>('[data-post-uri]')?.dataset.postUri ===
      saved.postUri
    ) {
      return link
    }
  }
}

function positionsMatch(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= POSITION_TOLERANCE_PX
}

export function restorePostFeedScrollWhen(
  ready: () => Element | undefined,
  revealPost?: (postUri: string) => void,
): void {
  $effect(() => {
    const current = currentPage()
    const origin = current.state.postFeedOrigin
    const feedUrl = current.url
    const root = ready()
    if (!origin || origin.url !== feedUrl || !root) return

    let frame: number | undefined
    let restoreStartedAt: DOMHighResTimeStamp | undefined
    let requestedInitialPixel = false
    let stableAnchorSince: DOMHighResTimeStamp | undefined

    const attemptRestore = (timestamp: DOMHighResTimeStamp) => {
      frame = undefined
      const latest = currentPage()
      if (latest.state.postFeedOrigin !== origin || latest.url !== feedUrl)
        return
      restoreStartedAt ??= timestamp
      if (timestamp - restoreStartedAt >= FEED_SCROLL_RESTORE_DEADLINE_MS)
        return

      if (!origin.anchor || !requestedInitialPixel) {
        window.scrollTo({ top: origin.scrollY, behavior: 'instant' })
        requestedInitialPixel = true
      }

      let restored = positionsMatch(window.scrollY, origin.scrollY)
      if (origin.anchor) {
        const anchor = findReturnAnchor(root, origin.anchor)
        restored = false
        if (anchor) {
          const currentTop = anchor.getBoundingClientRect().top
          if (!positionsMatch(currentTop, origin.anchor.viewportTop)) {
            stableAnchorSince = undefined
            window.scrollTo({
              top: window.scrollY + currentTop - origin.anchor.viewportTop,
              behavior: 'instant',
            })
          }
          if (
            positionsMatch(
              anchor.getBoundingClientRect().top,
              origin.anchor.viewportTop,
            )
          ) {
            stableAnchorSince ??= timestamp
            restored = timestamp - stableAnchorSince > ANCHOR_STABLE_DURATION_MS
          } else {
            stableAnchorSince = undefined
          }
        } else {
          stableAnchorSince = undefined
          revealPost?.(origin.anchor.postUri)
        }
      }

      const afterRestore = currentPage()
      if (
        afterRestore.state.postFeedOrigin !== origin ||
        afterRestore.url !== feedUrl
      ) {
        return
      }

      if (!restored) {
        frame = requestAnimationFrame(attemptRestore)
        return
      }

      const state = { ...afterRestore.state }
      delete state.postFeedOrigin
      replaceState(feedUrl, state)
    }

    frame = requestAnimationFrame(attemptRestore)

    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  })
}
