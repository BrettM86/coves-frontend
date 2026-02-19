import { coves } from '$lib/api/client.svelte'
import type { Handle } from '$lib/types/atproto'
import { communityHandleFromSlug, ReactiveState } from '$lib/app/util.svelte'
import CommunityCard from '$lib/feature/community/CommunityCard.svelte'

export async function load({ fetch, params }) {
  const handle = communityHandleFromSlug(params.handle) as Handle

  const community = await coves({ func: fetch }).getCommunity({
    community: handle,
  })

  return {
    community: new ReactiveState(community),
    slots: {
      sidebar: {
        component: CommunityCard,
        props: {
          community: community,
        },
      },
    },
  }
}
