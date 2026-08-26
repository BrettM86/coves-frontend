import type { CommunityRef, CommunityView } from '$lib/api/coves/types'
import { communitySlug } from '$lib/app/util/links'
import { usableHandle } from '$lib/types/atproto'

function communityHandle(
  community: CommunityView | CommunityRef,
): string | undefined {
  return usableHandle(community.handle)
}

/**
 * Returns the identifier string for a community (for URLs, route params, etc.).
 * Prefers the canonical slug form of `handle` (no `c-` prefix, matching
 * {@link postLink} permalinks), falling back to `did` — both are accepted by
 * the `[handle=handle]` route matcher, whereas a bare `name` (e.g. "general")
 * would build a URL the router refuses. For human-readable text use
 * {@link communityHandleOrName} or {@link communityDisplayName} instead.
 */
export function communityIdentifier(
  community: CommunityView | CommunityRef,
): string {
  const handle = communityHandle(community)
  return handle ? communitySlug(handle) : community.did
}

/**
 * Returns a human-readable identifier for display copy (e.g. `!handle` text,
 * list detail lines). Prefers `handle` over `name` and never degrades to a
 * DID — for URLs use {@link communityIdentifier} instead.
 *
 * The `c-` prefix is an internal namespacing convention, so the handle is
 * shown in its canonical form (`science.coves.social`, not
 * `c-science.coves.social`).
 */
export function communityHandleOrName(
  community: CommunityView | CommunityRef,
): string {
  const handle = communityHandle(community)
  return handle ? communitySlug(handle) : community.name
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
