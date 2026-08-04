import { usableHandle } from '$lib/types/atproto'

/** The identity fields every user-shaped view carries. */
export interface UserIdentity {
  did: string
  handle?: string
}

/**
 * Returns the label for a user: their handle, sigil included, falling back to
 * the DID when the handle is missing or unresolvable.
 *
 * A user's handle is optional on some views (`ProfileViewDetailed`) and may be
 * ATProto's `handle.invalid` sentinel, so labelling it blindly would render
 * `@undefined` or a dead-looking `@handle.invalid`. The DID is unlovely but
 * true, and it is what {@link userLink} already routes to in the same case.
 */
export function userLabel(user: UserIdentity): string {
  const handle = usableHandle(user.handle)
  return handle ? `@${handle}` : user.did
}
