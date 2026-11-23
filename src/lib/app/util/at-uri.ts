import type { AtUri } from '$lib/api/coves/types'
import type { DID } from '$lib/types/atproto'

/** The DID-only AT URI (`at://<did>`) that names an account. */
export function didAtUri(did: DID): AtUri {
  return `at://${did}` as AtUri
}

/** The AT URI of a community's profile record, which describes the community. */
export function communityProfileAtUri(did: DID): AtUri {
  return `at://${did}/social.coves.community.profile/self` as AtUri
}
