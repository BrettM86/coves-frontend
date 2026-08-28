import type { ParamMatcher } from '@sveltejs/kit'
import { isValidDID, isValidHandle } from '$lib/types/atproto'

/**
 * Matches the identifiers the AppView resolves for a *user*: a DID or a DNS
 * handle. Used by `/profile/[handle=actor]` and `/u/[handle=actor]`.
 *
 * Deliberately narrower than the community matcher (`./handle`): a bare
 * label is never a valid user identifier, and admitting one here would let
 * `/profile/alice` shadow the static siblings (`/profile/settings`,
 * `/profile/media`, …) and reach the loader with an input it must reject.
 */
export const match: ParamMatcher = (param) => {
  const decoded = decodeURIComponent(param)
  return isValidDID(decoded) || isValidHandle(decoded)
}
