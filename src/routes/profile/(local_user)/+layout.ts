import { redirect } from '@sveltejs/kit'
import type { LayoutLoad } from './$types'

export const load: LayoutLoad = async ({ parent }) => {
  // Use the validated session before the root component syncs browser state.
  const { session } = await parent()
  if (!session?.authenticated) redirect(302, '/login')

  return {
    // TODO(coves-migration): Fetch from Coves API when available
    my_user: undefined,
  }
}
