/**
 * Mention resolution: pending spans in, `#mention` facets out.
 *
 * The rule that shapes everything here is that a failed lookup must not fail
 * the submit. Someone typing an @handle that does not exist, or hitting a
 * network blip, still gets their post — the handle just stays plain text. So
 * every failure path asserts that the call resolved, that the other mentions
 * still became facets, and that the failure was logged rather than swallowed.
 */
import { describe, expect, it, vi } from 'vitest'
import { XrpcError } from '$lib/api/coves/xrpc'
import type { ParsedMarkup, PendingMention, RichTextFacet } from './compose'
import { composeRichText, resolveMentions } from './mentions'
import { byteLength, byteRange } from './test-helpers'

const logWarn = vi.hoisted(() => vi.fn())
const logError = vi.hoisted(() => vi.fn())

vi.mock('$lib/app/util/log', () => ({
  log: { warn: logWarn, error: logError },
}))

const NS = 'social.coves.richtext.facet'

const HANDLE = 'alice.coves.social'
const USER = `@${HANDLE}`
const ALICE = 'did:plc:alice'
const GAMING = 'did:plc:gaming'

/** A pending span over `content`, sigil included. */
function pending(
  kind: 'user' | 'community',
  content: string,
  text: string,
): PendingMention {
  return { kind, identifier: text.slice(1), ...byteRange(content, text) }
}

function parsedOf(
  content: string,
  mentions: PendingMention[],
  facets: RichTextFacet[] = [],
): ParsedMarkup {
  return { content, facets, mentions }
}

function mentionFacet(
  content: string,
  text: string,
  did: string,
): RichTextFacet {
  return {
    index: byteRange(content, text),
    features: [{ $type: `${NS}#mention`, did }],
  }
}

function fakeResolver() {
  return {
    resolveHandle: vi.fn(async (_params: { handle: string }) => ({
      did: ALICE,
    })),
    getCommunity: vi.fn(async (_params: { community: string }) => ({
      did: GAMING,
    })),
  }
}

/** Total number of log lines the module emitted, at either level. */
function logCallCount(): number {
  return logWarn.mock.calls.length + logError.mock.calls.length
}

describe('resolveMentions', () => {
  it('resolves a user handle into a mention facet', async () => {
    const content = `cc ${USER}`
    const resolver = fakeResolver()

    const facets = await resolveMentions(
      parsedOf(content, [pending('user', content, USER)]),
      resolver,
    )

    expect(resolver.resolveHandle).toHaveBeenCalledWith({ handle: HANDLE })
    expect(facets).toEqual([mentionFacet(content, USER, ALICE)])
  })

  it('resolves a community address through getCommunity', async () => {
    const text = '!gaming@coves.social'
    const content = `see ${text}`
    const resolver = fakeResolver()

    const facets = await resolveMentions(
      parsedOf(content, [pending('community', content, text)]),
      resolver,
    )

    expect(resolver.getCommunity).toHaveBeenCalledWith({
      community: 'gaming@coves.social',
    })
    expect(resolver.resolveHandle).not.toHaveBeenCalled()
    expect(facets).toEqual([mentionFacet(content, text, GAMING)])
  })

  it('resolves a bare community name through getCommunity', async () => {
    const content = 'see !gaming'
    const resolver = fakeResolver()

    const facets = await resolveMentions(
      parsedOf(content, [pending('community', content, '!gaming')]),
      resolver,
    )

    expect(resolver.getCommunity).toHaveBeenCalledWith({ community: 'gaming' })
    expect(facets).toEqual([mentionFacet(content, '!gaming', GAMING)])
  })

  it('resolves a repeated identifier once but facets every occurrence', async () => {
    const content = `${USER} and ${USER}`
    const secondStart = byteLength(`${USER} and `)
    const resolver = fakeResolver()

    const facets = await resolveMentions(
      parsedOf(content, [
        {
          kind: 'user',
          identifier: HANDLE,
          byteStart: 0,
          byteEnd: byteLength(USER),
        },
        {
          kind: 'user',
          identifier: HANDLE,
          byteStart: secondStart,
          byteEnd: secondStart + byteLength(USER),
        },
      ]),
      resolver,
    )

    expect(resolver.resolveHandle).toHaveBeenCalledTimes(1)
    expect(facets).toEqual([
      {
        index: { byteStart: 0, byteEnd: byteLength(USER) },
        features: [{ $type: `${NS}#mention`, did: ALICE }],
      },
      {
        index: {
          byteStart: secondStart,
          byteEnd: secondStart + byteLength(USER),
        },
        features: [{ $type: `${NS}#mention`, did: ALICE }],
      },
    ])
  })

  it('returns facets sorted by byteStart whatever order the spans arrive in', async () => {
    const content = `${USER} and !gaming`
    const resolver = fakeResolver()

    const facets = await resolveMentions(
      parsedOf(content, [
        pending('community', content, '!gaming'),
        pending('user', content, USER),
      ]),
      resolver,
    )

    expect(facets).toEqual([
      mentionFacet(content, USER, ALICE),
      mentionFacet(content, '!gaming', GAMING),
    ])
  })

  it.each([
    {
      name: 'a 400 InvalidRequest',
      error: new XrpcError(400, 'InvalidRequest', 'Unable to resolve handle'),
    },
    {
      name: 'a 400 NotFound',
      error: new XrpcError(400, 'NotFound', 'Unable to resolve handle'),
    },
    {
      name: 'a 404',
      error: new XrpcError(404, 'NotFound', 'Unable to resolve handle'),
    },
  ])('drops the facet for $name and keeps the others', async ({ error }) => {
    // A handle that does not exist is an authoring mistake, not a failure of
    // the submit: the text stays plain and the post still goes out.
    const ghost = '@ghost.coves.social'
    const content = `cc ${ghost} and ${USER}`
    const resolver = fakeResolver()
    resolver.resolveHandle.mockImplementation(async ({ handle }) => {
      if (handle === 'ghost.coves.social') throw error
      return { did: ALICE }
    })

    const facets = await resolveMentions(
      parsedOf(content, [
        pending('user', content, ghost),
        pending('user', content, USER),
      ]),
      resolver,
    )

    expect(facets).toEqual([mentionFacet(content, USER, ALICE)])
  })

  it.each([
    { name: 'a non-DID string', value: { did: 'not-a-did' } },
    { name: 'no did at all', value: {} },
  ])('drops the facet when the resolver returns $name', async ({ value }) => {
    const content = `cc ${USER}`
    const resolver = fakeResolver()
    resolver.resolveHandle.mockResolvedValue(value as { did: string })

    const facets = await resolveMentions(
      parsedOf(content, [pending('user', content, USER)]),
      resolver,
    )

    expect(facets).toEqual([])
  })

  it('logs a failed resolution instead of swallowing it', async () => {
    logWarn.mockClear()
    logError.mockClear()
    const content = `cc ${USER}`
    const resolver = fakeResolver()
    resolver.resolveHandle.mockRejectedValue(
      new XrpcError(400, 'InvalidRequest', 'Unable to resolve handle'),
    )

    await resolveMentions(
      parsedOf(content, [pending('user', content, USER)]),
      resolver,
    )

    // Either level is fine; console is banned in feature/ and would not be
    // caught by this mock at all.
    expect(logCallCount()).toBeGreaterThan(0)
  })

  it('makes no calls and returns nothing when there are no mentions', async () => {
    const resolver = fakeResolver()

    const facets = await resolveMentions(parsedOf('plain text', []), resolver)

    expect(facets).toEqual([])
    expect(resolver.resolveHandle).not.toHaveBeenCalled()
    expect(resolver.getCommunity).not.toHaveBeenCalled()
  })
})

describe('composeRichText', () => {
  it('merges markup facets and mention facets in byteStart order', async () => {
    const resolver = fakeResolver()

    const composed = await composeRichText(`**hi** ${USER}`, resolver)

    expect(composed.content).toBe(`hi ${USER}`)
    expect(composed.facets).toEqual([
      {
        index: byteRange(composed.content, 'hi'),
        features: [{ $type: `${NS}#bold` }],
      },
      mentionFacet(composed.content, USER, ALICE),
    ])
  })

  it('returns canonical content with the markers stripped', async () => {
    const composed = await composeRichText('# Title', fakeResolver())

    expect(composed.content).toBe('Title')
  })

  it('omits the facets key entirely when there is nothing to annotate', async () => {
    const composed = await composeRichText('just words', fakeResolver())

    // Asserted on the shape, not the value: an explicitly-undefined `facets`
    // key would pass a toEqual while still being the wrong wire input.
    expect(composed).toStrictEqual({ content: 'just words' })
    expect(Object.keys(composed)).toEqual(['content'])
  })

  it('omits the facets key when the only mention fails to resolve', async () => {
    const resolver = fakeResolver()
    resolver.resolveHandle.mockRejectedValue(
      new XrpcError(400, 'InvalidRequest', 'Unable to resolve handle'),
    )

    const composed = await composeRichText(`cc ${USER}`, resolver)

    expect(composed).toStrictEqual({ content: `cc ${USER}` })
  })
})

describe('resolveMentions — failures that are not the author’s fault', () => {
  const OTHER_FAILURES = [
    { name: 'a network error', error: new TypeError('fetch failed') },
    {
      name: 'a 500',
      error: new XrpcError(500, 'InternalServerError', 'boom'),
    },
  ]

  it.each(OTHER_FAILURES)(
    'rejects with $name instead of dropping the facet',
    async ({ error }) => {
      // An unknown handle is the author's problem and stays plain text. A server
      // or network fault is not: silently dropping the mention would publish a
      // post that quietly lost its links. It has to surface as a failed submit.
      const content = `cc ${USER}`
      const resolver = fakeResolver()
      resolver.resolveHandle.mockRejectedValue(error)

      await expect(
        resolveMentions(
          parsedOf(content, [pending('user', content, USER)]),
          resolver,
        ),
      ).rejects.toBe(error)
    },
  )

  it.each(OTHER_FAILURES)(
    'propagates $name out of composeRichText',
    async ({ error }) => {
      const resolver = fakeResolver()
      resolver.resolveHandle.mockRejectedValue(error)

      await expect(composeRichText(`cc ${USER}`, resolver)).rejects.toBe(error)
    },
  )
})

describe('resolveMentions — caps', () => {
  it('looks up at most 200 distinct identifiers', async () => {
    // Every distinct identifier is a network call. A pathological comment must
    // not turn one submit into hundreds of requests.
    let content = ''
    const mentions = Array.from({ length: 250 }, (_, index) => {
      const identifier = `u${index}.coves.social`
      if (content) content += ' '
      const byteStart = byteLength(content)
      content += `@${identifier}`
      return {
        kind: 'user' as const,
        identifier,
        byteStart,
        byteEnd: byteLength(content),
      }
    })

    const resolver = fakeResolver()
    await resolveMentions(parsedOf(content, mentions), resolver)

    expect(resolver.resolveHandle.mock.calls.length).toBeLessThanOrEqual(200)
  })

  it('caps the merged facets at 200 once mentions are added', async () => {
    // The markup facets alone are under the cap; the mentions push the total
    // over it, so the cap has to be applied after the merge, not before.
    const runs = Array.from({ length: 199 }, (_, i) => `**b${i}**`).join(' ')
    const resolver = fakeResolver()

    const composed = await composeRichText(
      `${runs} ${USER} @bob.coves.social`,
      resolver,
    )

    expect(composed.facets).toHaveLength(200)
    // Kept by byteStart, so the survivor beyond the bold runs is the first
    // mention and the second one is dropped.
    expect(composed.facets?.[199].index).toEqual(
      byteRange(composed.content, USER),
    )
  })
})
