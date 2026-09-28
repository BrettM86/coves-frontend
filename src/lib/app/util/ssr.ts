import { browser } from '$app/environment'

let hydrated = false

/**
 * Called once the first page has mounted in the browser. Every load after
 * this is a client-side navigation.
 */
export function markHydrated(): void {
  hydrated = true
}

/**
 * True on the server and until the first page has mounted in the browser:
 * anything rendered now has to match the markup the server sent, or
 * hydration discards it.
 */
export function renderingServerMarkup(): boolean {
  return !hydrated
}

/**
 * Streams `promise` to the client on client-side navigations, but awaits it
 * during SSR so the server never renders a pending placeholder — and during
 * the hydrating load too. The server rendered the resolved value; handing
 * `{#await}` a promise there makes Svelte discard the server's markup and
 * start over from the pending branch. The hydrating load's requests are
 * replayed from the page (see `covesCustomFetch`), so awaiting them costs no
 * round trip. (With SSR switched off there is no markup to keep, and the
 * first render simply waits for the data instead of showing a skeleton.)
 *
 * `matchesServerRender` is false when the load built a different request
 * than the server did, which only ever had the default settings: the
 * response is not in the page, and the server's rows belong to other posts.
 * The hydrating load then streams too, so Svelte renders fresh rather than
 * hydrating one post's markup with another's data.
 *
 * A failed load in the browser still resolves, with the rejected promise, so
 * the page's `{:catch}` renders instead of Kit's error page. On the server it
 * throws.
 */
export const awaitIfServer = async <T>(
  promise: Promise<T>,
  matchesServerRender = true,
): Promise<{
  data: Promise<T> | T
}> => {
  if (browser && (hydrated || !matchesServerRender)) {
    // `{#await}` subscribes only once every load on the page has finished; a
    // failure before then would be reported as unhandled. The page still gets
    // the rejected promise for its `{:catch}`.
    void promise.catch(() => undefined)
    return { data: promise }
  }
  try {
    return { data: await promise }
  } catch (err) {
    if (!browser) throw err
    // Already rejected and already handled (by the await above), so this
    // raises no unhandled-rejection warning before `{#await}` subscribes.
    return { data: promise }
  }
}
