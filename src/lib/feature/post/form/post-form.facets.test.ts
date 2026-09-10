/**
 * Outer acceptance test for the facet write side.
 *
 * The post body is lightweight markup in the textarea, but the wire record is
 * canonical plaintext plus `social.coves.richtext.facet` annotations. This
 * pins the whole compile step end to end at the one place it has to happen:
 * `PostFormState.submit`. Markers are stripped from `content`, every construct
 * in the body lands as a facet with UTF-8 byte offsets in `byteStart` order,
 * the `@handle` is resolved to a DID through the client, and the optimistic
 * post view handed to the post page carries exactly what was sent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatePostInput } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'

const VIEWER = vi.hoisted(() => ({
  did: 'did:plc:viewer' as DID,
  handle: 'viewer.test' as Handle,
}))

const MENTIONED = vi.hoisted(() => ({
  handle: 'alice.coves.social',
  did: 'did:plc:alice',
}))

const createPost = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    uri: 'at://did:plc:author/social.coves.community.post/abc',
    cid: 'bafy...',
  }),
)

/**
 * Stands in for `com.atproto.identity.resolveHandle`. Only the one handle in
 * the body resolves; anything else is an unknown handle, as the AppView would
 * report it.
 */
const resolveHandle = vi.hoisted(() =>
  vi.fn(async (input: unknown) => {
    const handle =
      typeof input === 'string'
        ? input
        : (input as { handle?: string } | undefined)?.handle
    if (handle !== MENTIONED.handle)
      throw new Error(`unknown handle: ${handle}`)
    return { did: MENTIONED.did }
  }),
)

vi.mock('$lib/api/client.svelte', () => ({
  coves: () => ({ createPost, resolveHandle }),
}))

// `buildFreshPostView` bails out unless the viewer is authenticated, and the
// real auth module touches browser storage at import time.
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: {
    current: {
      type: 'authenticated',
      id: VIEWER.did,
      did: VIEWER.did,
      handle: VIEWER.handle,
    },
    isAuthenticated: true,
  },
}))

import { PostFormState } from '$lib/feature/post/form/post-form.svelte'

const FACET_NS = 'social.coves.richtext.facet'

const COMMUNITY = {
  did: 'did:plc:community' as DID,
  handle: 'cats.test' as Handle,
  name: 'cats',
}

/** The markup the author typed into the body textarea. */
const SOURCE = [
  '# Title',
  `Hello **wörld**, see https://example.com/a. and @${MENTIONED.handle}`,
].join('\n')

/** The canonical plaintext that markup compiles to: every marker stripped. */
const EXPECTED_CONTENT = [
  'Title',
  `Hello wörld, see https://example.com/a. and @${MENTIONED.handle}`,
].join('\n')

const encoder = new TextEncoder()

/**
 * UTF-8 byte range of `needle` within `EXPECTED_CONTENT`, measured rather than
 * hand-counted — "wörld" is two bytes wider than it is long, and every offset
 * after it depends on that.
 */
function byteRange(needle: string): { byteStart: number; byteEnd: number } {
  const index = EXPECTED_CONTENT.indexOf(needle)
  expect(index, `"${needle}" is not in the expected content`).toBeGreaterThan(
    -1,
  )
  const byteStart = encoder.encode(EXPECTED_CONTENT.slice(0, index)).length
  return { byteStart, byteEnd: byteStart + encoder.encode(needle).length }
}

/**
 * The exact facets the body compiles to, in `byteStart` order — the order is
 * part of the contract, so this array is compared as a sequence.
 */
const EXPECTED_FACETS = [
  {
    index: byteRange('Title'),
    features: [{ $type: `${FACET_NS}#heading`, level: 1 }],
  },
  {
    index: byteRange('wörld'),
    features: [{ $type: `${FACET_NS}#bold` }],
  },
  {
    // The sentence-ending '.' is not part of the URL.
    index: byteRange('https://example.com/a'),
    features: [{ $type: `${FACET_NS}#link`, uri: 'https://example.com/a' }],
  },
  {
    // The mention range covers the '@' sigil, not just the handle.
    index: byteRange(`@${MENTIONED.handle}`),
    features: [{ $type: `${FACET_NS}#mention`, did: MENTIONED.did }],
  },
]

/** The single `createPost` argument recorded by the mock. */
function createPostInput(): CreatePostInput {
  expect(createPost).toHaveBeenCalledTimes(1)
  return createPost.mock.calls[0][0] as CreatePostInput
}

describe('PostFormState rich text compilation', () => {
  beforeEach(() => {
    createPost.mockClear()
    resolveHandle.mockClear()
  })

  it('sends canonical content with facets and carries both on the optimistic view', async () => {
    const form = new PostFormState({
      community: COMMUNITY,
      title: 'a post',
      body: SOURCE,
    })

    const result = await form.submit()

    const input = createPostInput()
    expect(input.content).toBe(EXPECTED_CONTENT)
    expect(input.facets).toEqual(EXPECTED_FACETS)

    const record = result.post?.record
    expect(record).toBeDefined()
    expect(record?.content).toBe(EXPECTED_CONTENT)
    expect(record?.facets).toEqual(EXPECTED_FACETS)
  })
})
