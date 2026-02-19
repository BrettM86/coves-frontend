import type { CommunityRef, CommunityView } from '$lib/api/coves/types'

/**
 * Returns the identifier string for a community (for URLs, route params, etc.).
 * Prefers `handle` over `name`.
 */
export function communityIdentifier(
  community: CommunityView | CommunityRef,
): string {
  return community.handle ?? community.name
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
