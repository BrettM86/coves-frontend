import type { ParamMatcher } from '@sveltejs/kit'
import { isValidDID, isValidHandle } from '$lib/types/atproto'

export const match: ParamMatcher = (param) => {
  const decoded = decodeURIComponent(param)
  return isValidHandle(decoded) || isValidDID(decoded)
}
