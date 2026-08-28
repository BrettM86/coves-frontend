import type { ParamMatcher } from '@sveltejs/kit'
import {
  isValidCommunityAddress,
  isValidCommunityName,
  isValidDID,
  isValidHandle,
} from '$lib/types/atproto'

/**
 * Accepts every identifier the AppView resolves for `/c/[handle]`: a DID, a
 * DNS handle (`gaming.coves.social`), a community address
 * (`comicstrips@lemmy.world`) and a bare local community name (`gaming`).
 * The `!` sigil is display-only and never part of the URL.
 *
 * `/c` has no static sibling segments, so nothing needs reserving here — a
 * community may be named `settings`. User routes use the stricter
 * `./actor` matcher, which is what keeps `/profile/settings` routable.
 */
export const match: ParamMatcher = (param) => {
  let decoded: string
  try {
    decoded = decodeURIComponent(param)
  } catch {
    return false
  }
  return (
    isValidDID(decoded) ||
    isValidHandle(decoded) ||
    isValidCommunityAddress(decoded) ||
    isValidCommunityName(decoded)
  )
}
