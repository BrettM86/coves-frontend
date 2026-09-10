/**
 * Resolves the pending mentions `parseMarkup` found into `#mention` facets.
 *
 * A mention facet carries a DID, which only the AppView can supply, so this is
 * the one asynchronous step in composing rich text. A lookup that fails is not
 * an error the author should see: the handle simply stays plain text.
 */
import type {
  GetCommunityParams,
  ResolveHandleParams,
} from '$lib/api/coves/types'
import { XrpcError } from '$lib/api/coves/xrpc'
import { log } from '$lib/app/util/log'
import { isValidDID } from '$lib/types/atproto'
import {
  parseMarkup,
  type ParsedMarkup,
  type PendingMention,
  type RichTextFacet,
} from './compose'
import { FEATURE_TYPE, MAX_FACETS } from './facets'

/**
 * The two AppView lookups a mention can need. Structural on purpose: the app
 * passes the real client, tests pass a plain object.
 */
export interface MentionResolver {
  resolveHandle(params: ResolveHandleParams): Promise<{ did: string }>
  getCommunity(params: GetCommunityParams): Promise<{ did: string }>
}

/** Canonical content plus its facets; `facets` is absent when there are none. */
export interface ComposedRichText {
  content: string
  facets?: RichTextFacet[]
}

/** Cache key for a lookup: the same handle under a different sigil is a
 * different lookup, so the kind is part of the identity. */
function lookupKey(mention: PendingMention): string {
  return `${mention.kind}:${mention.identifier}`
}

/**
 * Whether this failure means the identifier does not exist.
 *
 * That is the author's problem and costs only the annotation: an unresolvable
 * handle stays plain text. Anything else — a 500, a network fault, an auth
 * error — is not, and silently dropping the mention there would publish a post
 * that quietly lost its links, so it has to surface as a failed submit.
 */
function isNotFound(error: unknown): boolean {
  return (
    error instanceof XrpcError && (error.status === 400 || error.status === 404)
  )
}

/**
 * The DID behind one mention, or null when the identifier does not resolve or
 * the answer is unusable. Only the kind goes in the log line; the identifier is
 * the author's content.
 */
async function resolveIdentity(
  mention: PendingMention,
  resolver: MentionResolver,
): Promise<string | null> {
  try {
    const resolved =
      mention.kind === 'user'
        ? await resolver.resolveHandle({ handle: mention.identifier })
        : await resolver.getCommunity({ community: mention.identifier })
    const did: unknown = resolved.did
    if (typeof did !== 'string' || !isValidDID(did)) {
      log.warn('mention resolved without a usable did', undefined, {
        kind: mention.kind,
      })
      return null
    }
    return did
  } catch (error) {
    if (!isNotFound(error)) throw error
    log.warn('mention did not resolve', error, { kind: mention.kind })
    return null
  }
}

/** One lookup per distinct identifier, run concurrently. */
async function resolveIdentities(
  mentions: readonly PendingMention[],
  resolver: MentionResolver,
): Promise<Map<string, string>> {
  const distinct = new Map<string, PendingMention>()
  for (const mention of mentions) {
    const key = lookupKey(mention)
    if (!distinct.has(key)) distinct.set(key, mention)
    // Every distinct identifier is a network call, and only the first 200
    // facets can survive the merge anyway.
    if (distinct.size >= MAX_FACETS) break
  }

  const resolved = new Map<string, string>()
  await Promise.all(
    [...distinct].map(async ([key, mention]) => {
      const did = await resolveIdentity(mention, resolver)
      if (did !== null) resolved.set(key, did)
    }),
  )
  return resolved
}

/** Turn pending mentions into `#mention` facets, sorted by byteStart. */
export async function resolveMentions(
  parsed: ParsedMarkup,
  resolver: MentionResolver,
): Promise<RichTextFacet[]> {
  const identities = await resolveIdentities(parsed.mentions, resolver)
  const facets: RichTextFacet[] = []
  for (const mention of parsed.mentions) {
    const did = identities.get(lookupKey(mention))
    // Every occurrence gets its own facet, from the one lookup they shared.
    if (did === undefined) continue
    facets.push({
      index: { byteStart: mention.byteStart, byteEnd: mention.byteEnd },
      features: [{ $type: FEATURE_TYPE.mention, did }],
    })
  }
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart)
}

/** Compile editor markup all the way to the wire shape. */
export async function composeRichText(
  source: string,
  resolver: MentionResolver,
): Promise<ComposedRichText> {
  const parsed = parseMarkup(source)
  const mentionFacets = await resolveMentions(parsed, resolver)
  const facets = [...parsed.facets, ...mentionFacets]
    .sort((a, b) => a.index.byteStart - b.index.byteStart)
    .slice(0, MAX_FACETS)
  // The key is absent rather than undefined when there is nothing to annotate:
  // the wire shape stays minimal.
  return facets.length > 0
    ? { content: parsed.content, facets }
    : { content: parsed.content }
}
