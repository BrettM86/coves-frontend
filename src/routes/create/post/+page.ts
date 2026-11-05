import type { PageLoad } from './$types'
import { profile } from '$lib/app/state/auth.svelte'
import { redirect } from '@sveltejs/kit'

export const load: PageLoad = async ({ url, parent }) => {
  // The request's session decides, not the stored profile: on a full load the
  // root layout has not yet synced the profile, which still holds the guest.
  // An expired session keeps the page: the draft is only in the form, and the
  // recovery prompt restores the login without leaving it.
  const { session, sessionExpired } = await parent()
  if (!session?.authenticated && !sessionExpired && !profile.sessionExpired)
    redirect(
      302,
      '/login?' + new URLSearchParams({ redirect: url.pathname + url.search }),
    )
}
