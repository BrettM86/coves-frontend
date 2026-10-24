import type { PageLoad } from './$types'
import { profile } from '$lib/app/state/auth.svelte'
import { redirect } from '@sveltejs/kit'

// The list is the reader's own: nothing to render on the server.
export const ssr = false

export const load: PageLoad = async ({ url, parent }) => {
  // The request's session decides, not the stored profile: on a fresh entry
  // (the OAuth callback's redirect) the root layout has not yet synced the
  // profile, which still holds the guest. An expired session keeps the page:
  // the recovery prompt restores the login without leaving it, and the list
  // reloads for the same owner.
  const { session, sessionExpired } = await parent()
  if (!session?.authenticated && !sessionExpired && !profile.sessionExpired)
    redirect(
      302,
      '/login?' + new URLSearchParams({ redirect: url.pathname + url.search }),
    )
}
