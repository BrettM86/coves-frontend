import { LOCAL_INSTANCE_DOMAIN } from '$lib/app/state/instance/domain'
import { usableHandle } from '$lib/types/atproto'
import {
  canonicalCommunityParam,
  encodeCommunityParam,
  type CommunityRouteSource,
} from './community'

/**
 * Strips the "c-" prefix from a community handle to produce its canonical form.
 *
 * Communities provisioned on a Coves instance use a "c-" prefix convention
 * (e.g. "c-mycommunity.coves.social") to distinguish community actors from
 * user actors in the ATProto namespace. Communities bridged in from other
 * platforms keep their source handle and carry no prefix, so this strips the
 * prefix only when it is actually there.
 *
 * The prefix is internal plumbing: route params, URLs, and any handle shown to
 * a user all use the bare form. There is deliberately no inverse — a slug is
 * sent to the API as-is, because the bare form is ambiguous (both
 * "gardening.coves.social" and a bridged "linux.lemmy-ml.tdpl.io" are
 * prefix-free) and only the AppView knows which stored handle it maps to. It
 * resolves either form.
 */
export function communitySlug(handle: string): string {
  return handle.startsWith('c-') ? handle.slice(2) : handle
}

/**
 * Returns the route param a community should be addressed by: the canonical
 * `name` / `name@origin` form when the AppView served an `origin` (see
 * {@link canonicalCommunityParam}), otherwise the legacy DNS-handle slug, and
 * the DID when the handle is missing or unresolved (`handle.invalid`). Every
 * form is accepted by the `[handle=handle]` matcher and resolved by the
 * AppView; only the canonical one survives the community page's redirect.
 *
 * Unencoded — pass through {@link encodeCommunityParam} when building a path.
 */
export function communityRouteParam(
  community: CommunityRouteSource,
  localDomain: string | null = LOCAL_INSTANCE_DOMAIN,
): string {
  const canonical = canonicalCommunityParam(community, localDomain)
  if (canonical) return canonical
  const handle = usableHandle(community.handle)
  return handle ? communitySlug(handle) : community.did
}

/**
 * Generate a link path for a community: `/c/gaming` for a local community,
 * `/c/comicstrips@lemmy.world` for a remote one, and the legacy
 * `/c/<handle>` / `/c/<did>` when the response carried no `origin`.
 * Accepts a Coves CommunityRef or CommunityView (or any `did` + optional
 * `handle`/`name`/`origin` shape).
 */
export function communityLink(
  community: CommunityRouteSource,
  prefix: string = '',
): string {
  return `${prefix}/c/${encodeCommunityParam(communityRouteParam(community))}`
}

/**
 * Generate a link path for a user profile.
 *
 * Takes any user-shaped view: `handle` is optional on some of them
 * (`ProfileViewDetailed`) and the DID route is the fallback either way.
 */
export function userLink(
  user: { did: string; handle?: string },
  prefix: string = '',
): string {
  if (user.handle) {
    return `${prefix}/profile/${encodeURIComponent(user.handle)}`
  }
  return `${prefix}/profile/${encodeURIComponent(user.did)}`
}
