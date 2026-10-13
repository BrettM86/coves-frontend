import type { AtUri, CommunityRef, PostViewUnion } from '$lib/api/coves/types'
import {
  isHydratedPost,
  isModeratedPost,
  isValidAtUri,
  parseAtUri,
} from '$lib/api/coves/types'
import { XrpcError } from '$lib/api/coves/xrpc'
import type { CovesClient } from '$lib/api/coves/client'
import { log } from '$lib/app/util/log'
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
 * Whether a getComments failure means the post the thread hangs off is gone,
 * typically removed between the post request and the comments request. The
 * backend reports it as 404 `RootNotFound`. `NotFound` is the backend's
 * generic not-found catch-all, accepted because the getComments lexicon
 * declares it. A 404 `ParentNotFound` names a missing comment instead.
 */
export function isThreadRootGoneError(err: unknown): err is XrpcError {
  return (
    err instanceof XrpcError &&
    err.status === 404 &&
    (err.errorName === 'RootNotFound' || err.errorName === 'NotFound')
  )
}

/**
 * Logs a getComments failure that `isThreadRootGoneError` accepted. The
 * generic `NotFound` gets its own wording: the backend is expected to name
 * `RootNotFound`, so a run of the catch-all is worth noticing.
 */
export function logThreadRootGone(err: XrpcError, uri: AtUri): void {
  if (err.errorName === 'RootNotFound') {
    log.warn(`[post] Thread root gone (RootNotFound) for ${uri}`)
  } else {
    log.warn(
      `[post] getComments answered a generic ${err.errorName} for ${uri}; reading it as a gone thread root`,
    )
  }
}

/** Why a post that did not hydrate cannot be shown. */
export type PostUnavailableKind =
  'moderated' | 'removed' | 'blocked' | 'notFound'

/**
 * A comments result whose thread is gone: the post was removed after it was
 * fetched. A re-probe of the post adds what happened to it (and, for a
 * moderated post, its community), so the page can show its tombstone.
 */
export type UnavailableThread = {
  unavailable: true
  postUnavailable?: PostUnavailableKind
  community?: CommunityRef
}

/**
 * Classifies a `getPosts` element that is not a hydrated post. A sentinel this
 * client does not recognise (an unknown `$type`, say) reads as `notFound`.
 */
export function unavailablePostKind(
  result: PostViewUnion | null | undefined,
): PostUnavailableKind {
  if (result == null) return 'notFound'
  if (isModeratedPost(result)) return 'moderated'
  if ('removed' in result) return 'removed'
  if ('blocked' in result) return 'blocked'
  if ('$type' in result && !('notFound' in result)) {
    log.warn(
      `[post] Unknown post.get variant ${String(result.$type)} for ${result.uri}; treating it as notFound`,
    )
  }
  return 'notFound'
}

/**
 * Which of two answers for the same record to report, best first: a hydrated
 * post, then the moderation outcomes (a real answer about a real record), then
 * a block, then "not found".
 */
const AVAILABILITY_PRECEDENCE: readonly PostUnavailableKind[] = [
  'moderated',
  'removed',
  'blocked',
  'notFound',
]

function availabilityRank(result: PostViewUnion): number {
  if (isHydratedPost(result)) return -1
  return AVAILABILITY_PRECEDENCE.indexOf(unavailablePostKind(result))
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
 * Asks again what happened to a post whose thread just came back gone. A post
 * that still hydrates leaves the bare "thread unavailable" answer: the
 * comments are gone either way. A re-probe that fails reads as `notFound`,
 * since the gone thread already showed the backend withholds the post.
 */
export async function reprobeGoneThread(
  client: Pick<CovesClient, 'getPosts'>,
  uri: AtUri,
): Promise<UnavailableThread> {
  let fresh: PostViewUnion
  try {
    fresh = await fetchExactPost(client, uri)
  } catch (err) {
    log.warn(`[post] Re-probe of ${uri} failed`, err)
    return { unavailable: true, postUnavailable: 'notFound' }
  }
  if (isHydratedPost(fresh)) {
    // The backend contradicts itself: the thread root is gone, the post not.
    log.warn(`[post] ${uri} still hydrates although its thread root is gone`)
    return { unavailable: true }
  }
  return {
    unavailable: true,
    postUnavailable: unavailablePostKind(fresh),
    community: isModeratedPost(fresh) ? fresh.community : undefined,
  }
}

/**
 * Resolves the `<owner>` permalink segment to the DID of the repo the post
 * record lives in. The segment is whatever the `actor` route matcher accepts,
 * so a DID is already the answer and costs no request; a handle needs the one
 * backend hop. Rejections propagate so the caller can turn an unknown handle
 * into a 404 rather than building an unroutable AT-URI from it.
 *
 * `resolveHandle`, not `getProfile`: only the DID is needed, and the AppView
 * answers it from one indexed lookup where a profile also runs its counts.
 * It reports an unknown handle as 400 `InvalidRequest` (the PDS convention);
 * that is rethrown as the 404 callers read as "this record cannot exist". Any
 * other 400 — the `/api/proxy` hop's own, say — propagates unchanged.
 */
export async function resolveOwnerDid(
  client: Pick<CovesClient, 'resolveHandle'>,
  owner: string,
): Promise<DID> {
  if (isValidDID(owner)) return owner

  // The matcher admits only DIDs and handles, so the non-DID case is a handle.
  try {
    const { did } = await client.resolveHandle({ handle: owner as Handle })
    return did
  } catch (err) {
    if (
      err instanceof XrpcError &&
      err.status === 400 &&
      err.errorName === 'InvalidRequest'
    ) {
      throw new XrpcError(404, 'NotFound', err.message)
    }
    throw err
  }
}

/**
 * Fetches a post from its owner repo and rkey, covering both collections in
 * one request: `postv2` (author-owned, the current shape) and the superseded
 * community-owned `post`. Batching them means a legacy permalink costs the
 * same single round-trip as a current one.
 *
 * Returns the AT-URI that answered alongside its view, so the caller can go on
 * using the exact URI the backend hydrated (comments are keyed by it). When
 * the two probes disagree, the better answer wins whichever collection gave it
 * (see `AVAILABILITY_PRECEDENCE`): a withheld or removed record is a real
 * answer, while "not found" would misreport it as deleted. A tie goes to
 * `postv2`.
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
  return availabilityRank(legacy) < availabilityRank(postV2)
    ? { uri: legacyUri, result: legacy }
    : { uri: postV2Uri, result: postV2 }
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
