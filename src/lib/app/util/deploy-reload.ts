import type { BeforeNavigate } from '@sveltejs/kit'

/** The parts of a `beforeNavigate` navigation the decision reads. */
export type ReloadCandidate = Pick<BeforeNavigate, 'type' | 'willUnload'> & {
  from: { url: URL } | null
  to: { url: URL } | null
}

/**
 * Where to send the browser with a full page load once a new deploy is out
 * (`updated` from `$app/state`), so an open tab moves onto the new build on
 * its next link click instead of running the old code until a reload.
 * Undefined leaves the navigation to the client router: the build is current,
 * the page is unloading anyway, or the link only jumps to an anchor on the
 * same page. `goto` is left alone because its callers may pass `replaceState`
 * or history `state`, or show a toast just before it, and a full load would
 * drop all three; back and forward steps are left alone too.
 */
export function deployReloadTarget(
  updated: boolean,
  navigation: ReloadCandidate,
): string | undefined {
  if (!updated || navigation.willUnload || !navigation.to) return undefined
  if (navigation.type !== 'link') return undefined
  const to = navigation.to.url
  const from = navigation.from?.url
  const anchorJump =
    from &&
    to.hash !== '' &&
    to.hash !== from.hash &&
    from.pathname === to.pathname &&
    from.search === to.search
  return anchorJump ? undefined : to.href
}
