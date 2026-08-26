import type {
  CommunityRef,
  CommunityView as CovesCommunityView,
} from '$lib/api/coves/types'

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
 * Generate a link path for a community.
 * Accepts a Coves CommunityRef or CommunityView.
 *
 * Falls back to the community DID when the handle is missing — the
 * `[handle=handle]` route matcher accepts handles and DIDs but not bare
 * community names, so a `name`-based URL would 404 at routing.
 */
export function communityLink(
  community: CommunityRef | CovesCommunityView,
  prefix: string = '',
): string {
  if ('handle' in community && community.handle) {
    return `${prefix}/c/${encodeURIComponent(communitySlug(community.handle))}`
  }
  return `${prefix}/c/${encodeURIComponent(community.did)}`
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
