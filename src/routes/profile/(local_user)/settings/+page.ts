import { coves } from '$lib/api/client.svelte'
import type { PageLoad } from './$types'

export const load: PageLoad = async ({ parent, fetch }) => {
  const { session } = await parent()
  if (!session?.authenticated) return { profile: undefined }

  return {
    profile: await coves({ func: fetch }).getProfile({
      actor: session.account.did,
    }),
  }
}
