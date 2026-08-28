import type { CommunityRef, CommunityView } from '$lib/api/coves/types'
import { encodeCommunityParam } from '$lib/app/util/community'
import { communityRouteParam } from '$lib/app/util/links'

/**
 * Display forms of a community (`!name@origin` and sigil-less `name@origin`).
 * Live in `app/util` so the `ui/` layer can share them; re-exported here as
 * the feature-level entry point.
 */
export { communityAddress, communityMention } from '$lib/app/util/community'

/**
 * Returns the identifier string for a community (for URLs, route params, etc.):
 * the canonical `name` / `name@origin` when the AppView served an `origin`,
 * else the slug form of `handle` (no `c-` prefix), else `did`. All are
 * accepted by the `[handle=handle]` route matcher. For human-readable text
 * use {@link communityMention} or {@link communityDisplayName} instead.
 */
export function communityIdentifier(
  community: CommunityView | CommunityRef,
): string {
  return encodeCommunityParam(communityRouteParam(community))
}

/**
 * Returns the human-readable display name for a community.
 * Prefers `displayName` over `name`.
 */
export function communityDisplayName(
  community: CommunityView | CommunityRef,
): string {
  if ('displayName' in community && community.displayName) {
    return community.displayName
  }
  return community.name
}
