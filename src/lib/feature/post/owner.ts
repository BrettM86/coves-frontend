import type { AtUri, PostViewUnion } from '$lib/api/coves/types'
import { isHydratedPost, isValidAtUri, parseAtUri } from '$lib/api/coves/types'
import { XrpcError } from '$lib/api/coves/xrpc'
import type { CovesClient } from '$lib/api/coves/client'
import { type DID, type Handle, isValidDID } from '$lib/types/atproto'
import {
  buildLegacyPostAtUri,
  buildPostAtUri,
  LEGACY_POST_COLLECTION,
  POST_COLLECTION,
  postLink,
} from './helpers'
import type { PostSubmitResult } from './form/post-form.svelte'

/**
 * Whether a failed lookup means "no such record" rather than a real failure.
 * The backend answers an unknown actor with HTTP 404, which from a visitor's
 * side is indistinguishable from a permalink that never named anything; an
 * outage or a bad request must stay an error instead of being disguised as a
 * missing post. Matched on the status alone, since the error name varies by
 * endpoint (`ActorNotFound`, `NotFound`, ...).
 */
export function isNotFoundError(err: unknown): boolean {
  return err instanceof XrpcError && err.status === 404
}

/**
 * Whether an AT-URI addresses the post a permalink names: a well-formed URI
 * for a post record, in the owner's repo, with this rkey.
 *
 * Instant-display candidates (the create hand-off, the feed caches) and the
 * `?uri=` param are all only shortcuts around the probe, so one that points
 * elsewhere must be dropped rather than trusted. Every clause earns its place:
 * `?uri=` is user input, and splitting a bare string on "/" reads
 * `did:plc:x/collection/rkey` as a valid triple, so the scheme and shape are
 * checked before the parts are; rkeys are TIDs, unique per repo but not
 * across repos, so a same-rkey record from another author would otherwise
 * surface under someone else's permalink; and a URI from any other collection
 * (a comment, say) can never hydrate at the post endpoint.
 */
export function addressesRecord(
  uri: string | null | undefined,
  ownerDid: DID,
  rkey: string,
): boolean {
  // Rejects a missing scheme and, by its own shape, anything past the
  // did/collection/rkey triple — but it also admits a URI with no collection
  // or rkey at all, which `parseAtUri` then rejects.
  if (!uri || !isValidAtUri(uri)) return false
  try {
    const { did, collection, rkey: candidateRkey } = parseAtUri(uri)
    return (
      did === ownerDid &&
      candidateRkey === rkey &&
      (collection === POST_COLLECTION || collection === LEGACY_POST_COLLECTION)
    )
  } catch {
    return false
  }
}

/**
 * Fetches one exact AT-URI through the batch endpoint. Mirrors
 * `CovesClient.getPost`'s contract check — 1 URI in, exactly 1 element out —
 * for callers holding a client typed to the batch method alone.
 */
export async function fetchExactPost(
  client: Pick<CovesClient, 'getPosts'>,
  uri: AtUri,
): Promise<PostViewUnion> {
  const { posts } = await client.getPosts({ uris: [uri] })
  if (!Array.isArray(posts) || posts.length === 0) {
    throw new Error(
      `fetchExactPost(${uri}): batch endpoint returned ${
        Array.isArray(posts) ? '0 posts' : 'a non-array posts field'
      }, expected exactly 1`,
    )
  }
  return posts[0]
}

/**
 * Resolves the `<owner>` permalink segment to the DID of the repo the post
 * record lives in. The segment is whatever the `actor` route matcher accepts,
 * so a DID is already the answer and costs no request; a handle needs the one
 * backend hop. Rejections propagate so the caller can turn an unknown handle
 * into a 404 rather than building an unroutable AT-URI from it.
 */
export async function resolveOwnerDid(
  client: Pick<CovesClient, 'getProfile'>,
  owner: string,
): Promise<DID> {
  if (isValidDID(owner)) return owner

  // The matcher admits only DIDs and handles, so the non-DID case is a handle.
  const profile = await client.getProfile({ actor: owner as Handle })
  return profile.did
}

/**
 * Fetches a post from its owner repo and rkey, covering both collections in
 * one request: `postv2` (author-owned, the current shape) and the superseded
 * community-owned `post`. Batching them means a legacy permalink costs the
 * same single round-trip as a current one.
 *
 * Returns the AT-URI that answered alongside its view, so the caller can go on
 * using the exact URI the backend hydrated (comments are keyed by it). When
 * neither collection holds the record, the sentinel reported is the blocked
 * one if either probe was blocked — a withheld record is a real answer, while
 * "not found" would misreport it as deleted — and otherwise the `postv2`
 * notFound sentinel.
 */
export async function fetchPostByOwner(
  client: Pick<CovesClient, 'getPosts'>,
  ownerDid: DID,
  rkey: string,
): Promise<{ uri: AtUri; result: PostViewUnion }> {
  const postV2Uri = buildPostAtUri(ownerDid, rkey)
  const legacyUri = buildLegacyPostAtUri(ownerDid, rkey)

  const { posts } = await client.getPosts({ uris: [postV2Uri, legacyUri] })
  // Contract: 2 URIs in ⇒ exactly 2 elements out, in request order. A short
  // (or non-array) response is a backend contract violation, not a missing
  // post, so we throw rather than reading past the end of the array.
  if (!Array.isArray(posts) || posts.length < 2) {
    throw new Error(
      `fetchPostByOwner(${postV2Uri}): batch endpoint returned ${
        Array.isArray(posts)
          ? `${posts.length} posts`
          : 'a non-array posts field'
      }, expected exactly 2`,
    )
  }

  const [postV2, legacy] = posts
  if (isHydratedPost(postV2)) return { uri: postV2Uri, result: postV2 }
  if (isHydratedPost(legacy)) return { uri: legacyUri, result: legacy }
  if ('blocked' in postV2) return { uri: postV2Uri, result: postV2 }
  if ('blocked' in legacy) return { uri: legacyUri, result: legacy }
  return { uri: postV2Uri, result: postV2 }
}

/**
 * The permalink to redirect to right after creating a post. The optimistic
 * view the create flow builds carries the author, which yields the readable
 * owner segment; without it the segment falls back to the record's repo DID.
 * `?uri=` rides along because the AppView may not have indexed the record
 * yet, so the post page needs the exact URI to load it without a probe.
 */
export function createdPostLink(result: PostSubmitResult): string {
  return postLink(
    {
      uri: result.uri,
      community: result.community,
      author: result.post?.author,
    },
    true,
  )
}
