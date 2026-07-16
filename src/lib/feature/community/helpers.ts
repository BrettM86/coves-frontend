import type { CommunityRef, CommunityView } from '$lib/api/coves/types'
import { communitySlug } from '$lib/app/util.svelte'

/**
 * ATProto's sentinel for a handle that could not be resolved. Treat it as
 * "no handle": building URLs or display text from it produces dead links
 * (`/c/handle.invalid` always 404s).
 */
const INVALID_HANDLE = 'handle.invalid'

function usableHandle(
  community: CommunityView | CommunityRef,
): string | undefined {
  return community.handle && community.handle !== INVALID_HANDLE
    ? community.handle
    : undefined
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
  const handle = usableHandle(community)
  return handle ? communitySlug(handle) : community.did
}

/**
 * Returns a human-readable identifier for display copy (e.g. `!handle` text,
 * list detail lines). Prefers `handle` over `name` and never degrades to a
 * DID — for URLs use {@link communityIdentifier} instead.
 */
export function communityHandleOrName(
  community: CommunityView | CommunityRef,
): string {
  return usableHandle(community) ?? community.name
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
