import type { CommunityViewDetailed } from '$lib/api/coves/types'
import type { ReactiveState } from '$lib/app/util.svelte'
import { error } from '@sveltejs/kit'

// TODO(coves-migration): The community settings pages under this layout are
// unmigrated Lemmy code, and the Coves API has no community-update or
// moderator-management endpoints yet. Without this gate they render a blank
// crash (legacy `community_view` shape) or a management UI that cannot work.
// Remove the gate and migrate the pages once those APIs exist. The declared
// return type keeps the (currently unreachable) pages type-checking.
export function load(): { community: ReactiveState<CommunityViewDetailed> } {
  error(404, 'Community settings are not available yet')
}
