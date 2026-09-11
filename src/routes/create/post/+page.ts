import type { PageLoad } from './$types'
import { profile } from '$lib/app/state/auth.svelte'
import { redirect } from '@sveltejs/kit'

export const load: PageLoad = ({ url }) => {
  // An expired session keeps the page: the draft is only in the form, and the
  // recovery prompt restores the login without leaving it.
  if (!profile.current.jwt && !profile.sessionExpired)
    redirect(
      302,
      '/login?' + new URLSearchParams({ redirect: url.pathname + url.search }),
    )
}
