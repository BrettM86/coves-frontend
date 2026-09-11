import { redirect } from '@sveltejs/kit'
import { profile } from '$lib/app/state/auth.svelte'
import type { LayoutLoad } from './$types'

export const load: LayoutLoad = async ({ parent }) => {
  // Use the validated session before the root component syncs browser state.
  // An expired session is not a guest: the reader is still on this page with
  // the recovery prompt, and a redirect would throw away unsaved form state.
  // Once the dead cookie has been deleted the server reports a plain guest,
  // so in the browser the prompt's own state keeps the page as well
  // (`profile.sessionExpired` is always false during a server render).
  const { session, sessionExpired } = await parent()
  if (!session?.authenticated && !sessionExpired && !profile.sessionExpired)
    redirect(302, '/login')

  return {
    // TODO(coves-migration): Fetch from Coves API when available
    my_user: undefined,
  }
}
