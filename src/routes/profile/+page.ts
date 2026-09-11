import type { PageLoad } from './$types'
import { redirect } from '@sveltejs/kit'
import { profile } from '$lib/app/state/auth.svelte'

export const load: PageLoad = ({ url }) => {
  if (profile.current.type === 'authenticated') {
    const identifier = profile.current.handle ?? profile.current.did
    redirect(302, `/profile/${encodeURIComponent(identifier)}`)
  }
  redirect(
    302,
    '/login?' + new URLSearchParams({ redirect: url.pathname + url.search }),
  )
}
