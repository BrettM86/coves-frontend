import { profile } from '$lib/app/auth.svelte'
import { error } from '@sveltejs/kit'

export function load() {
  if (profile.current.type !== 'authenticated') error(401)

  return {
    // TODO(coves-migration): Fetch from Coves API when available
    my_user: undefined,
  }
}
