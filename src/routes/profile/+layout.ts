import { client } from '$lib/api/client.svelte'
import { profile } from '$lib/app/auth.svelte'
import { error } from '@sveltejs/kit'

// disable ssr, as the server cannot be authenticated
export const ssr = false

export async function load({ fetch }) {
  if (!profile.current.jwt) error(401)

  // TODO: Fetch user data from Coves API using DID
  const siteData = await client({ auth: profile.current?.jwt, func: fetch }).getSite()
  const my_user = siteData.my_user

  return {
    my_user: my_user,
    community_blocks: my_user?.community_blocks,
    person_blocks: my_user?.person_blocks,
    follows: my_user?.follows,
    moderates: my_user?.moderates,
  }
}
