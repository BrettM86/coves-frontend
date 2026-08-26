import { profile } from '$lib/app/state/auth.svelte'
import { redirect } from '@sveltejs/kit'

export const load = () => {
  if (!profile.current.jwt) redirect(302, '/login')
}
