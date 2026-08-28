import {
  isValidCommunityName,
  isValidHandle,
  usableHandle,
} from '$lib/types/atproto'
import { communitySlug } from './links'

/** The minimal community shape needed to render its `!name@origin` form. */
export interface CommunityMentionSource {
  readonly name: string
  readonly handle?: string
  readonly origin?: string
}

/**
 * Splits a resolvable community handle into its `name@origin` parts.
 *
 * Coves handles namespace the community with a `c-` prefix
 * (`c-nba.coves.social` → `nba@coves.social`); bridged communities use a
 * four-label `<name>.<instance>.tdpl.io` handle
 * (`linux.lemmy-ml.tdpl.io` → `linux@lemmy-ml.tdpl.io`). Any other shape is
 * not something we can split confidently, so the caller falls back to the
 * canonical slug.
 */
function splitHandle(handle: string): string | undefined {
  const labels = handle.split('.')
  if (handle.startsWith('c-') && labels.length >= 2) {
    const [name, ...rest] = labels
    return `${communitySlug(name)}@${rest.join('.')}`
  }
  if (labels.length === 4 && handle.endsWith('.tdpl.io')) {
    const [name, ...rest] = labels
    return `${name}@${rest.join('.')}`
  }
  return undefined
}

/**
 * Returns the display form of a community: `!name@origin`
 * (`!nba@coves.social`, `!comicstrips@lemmy.world`).
 *
 * This is the single place the `!` prefix and the `@origin` join are produced;
 * every piece of display copy should go through it. Prefers the structured
 * `origin` field; when it is absent the origin is derived from the handle,
 * and when the handle is missing or unresolved (`handle.invalid`) only the
 * bare `!name` is shown. Never degrades to a DID — for URLs and route params
 * use `communityLink`/`communityRouteParam` in `./links`, which pick the
 * canonical `name`/`name@origin` param and fall back to the DNS handle or DID.
 */
export function communityMention(community: CommunityMentionSource): string {
  return `!${communityAddress(community)}`
}

/**
 * Returns the sigil-less address of a community: `name@origin`
 * (`nba@coves.social`). Same derivation as {@link communityMention} without
 * the leading `!`, for compact secondary lines (list detail rows, pickers)
 * where the sigil would be visual noise.
 */
export function communityAddress(community: CommunityMentionSource): string {
  const origin = community.origin?.trim()
  if (origin) return `${community.name}@${origin}`
  const handle = usableHandle(community.handle)
  if (!handle) return community.name
  return splitHandle(handle) ?? communitySlug(handle)
}

/** The minimal community shape needed to pick its canonical route param. */
export interface CommunityRouteSource {
  readonly did: string
  readonly handle?: string
  readonly name?: string
  readonly origin?: string
}

/**
 * Returns the canonical `/c/<param>` route param for a community, following
 * Lemmy's convention: the bare `name` when the community's origin is the
 * instance this site serves, `name@origin` for every remote origin (a bridged
 * Lemmy community or another Coves instance). Both halves are lower-cased —
 * DNS names are case-insensitive and the AppView folds names the same way
 * when resolving — so there is exactly one canonical spelling to redirect to.
 *
 * Returns `undefined` when the community carries no `origin` (older AppView)
 * or when the pair would not survive the `[handle=handle]` route matcher —
 * callers then fall back to the legacy DNS-handle/DID param, which still
 * resolves and is redirected to the canonical form once loaded.
 *
 * Pure: `localDomain` is passed in (see `$lib/app/util/links` for the
 * deployment-bound wrapper) so the rule is unit-testable without env.
 */
export function canonicalCommunityParam(
  community: CommunityRouteSource,
  localDomain: string | null,
): string | undefined {
  const origin = community.origin?.trim().toLowerCase()
  const name = community.name?.trim().toLowerCase()
  if (!origin || !name || !isValidCommunityName(name)) return undefined
  if (origin === localDomain) return name
  if (!isValidHandle(origin)) return undefined
  return `${name}@${origin}`
}

/**
 * Percent-encodes a community route param for use in a path segment while
 * keeping the `@` of `name@origin` literal — `@` is a legal path character
 * (RFC 3986 `pchar`) and `%40` would make the canonical URL unreadable.
 */
export function encodeCommunityParam(param: string): string {
  return encodeURIComponent(param).replaceAll('%40', '@')
}
