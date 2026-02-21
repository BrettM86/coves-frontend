import { redirect } from '@sveltejs/kit'
import { profile } from '$lib/app/auth.svelte'

export function load() {
  if (profile.current.type === 'authenticated') {
    const identifier = profile.current.handle ?? profile.current.did
    redirect(302, `/profile/${encodeURIComponent(identifier)}`)
  }
  redirect(302, '/login')
}
