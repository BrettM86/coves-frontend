import type { PageLoad } from './$types'
import { profile } from '$lib/app/state/auth.svelte'
import { redirect } from '@sveltejs/kit'

export const load: PageLoad = ({ url }) => {
  if (!profile.current.jwt)
    redirect(
      302,
      '/login?' + new URLSearchParams({ redirect: url.pathname + url.search }),
    )
}
