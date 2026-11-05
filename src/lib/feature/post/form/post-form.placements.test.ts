/**
 * A post body holding an `![covered](image:N)` token for one of its attached
 * images compiles on submit: the record carries the covered text plus one
 * `#image` facet over it, and every attached image stays in `embed.images`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatePostInput } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import {
  imageFile,
  stubImageDecoding,
  stubObjectUrls,
  uploadOutput,
} from '$lib/feature/image-upload/test-helpers'

const VIEWER = vi.hoisted(() => ({
  did: 'did:plc:viewer' as DID,
  handle: 'viewer.test' as Handle,
}))

const createPost = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    uri: 'at://did:plc:author/social.coves.community.post/abc',
    cid: 'bafy...',
  }),
)

const uploadImage = vi.hoisted(() => vi.fn())

const resolveHandle = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error('no handle should be resolved')
  }),
)

vi.mock('$lib/api/client.svelte', () => ({
  coves: () => ({ createPost, uploadImage, resolveHandle }),
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

const COMMUNITY = {
  did: 'did:plc:community' as DID,
  handle: 'cats.test' as Handle,
  name: 'cats',
}

/** The single `createPost` argument recorded by the mock. */
function createPostInput(): CreatePostInput {
  expect(createPost).toHaveBeenCalledTimes(1)
  return createPost.mock.calls[0][0] as CreatePostInput
}

describe('PostFormState placement compilation', () => {
  beforeEach(() => {
    createPost.mockClear()
    uploadImage.mockReset()
    uploadImage.mockImplementation(async (file: Blob, contentType: string) =>
      uploadOutput(file, contentType),
    )
    stubImageDecoding()
    stubObjectUrls()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the covered text with one #image facet and both images', async () => {
    const form = new PostFormState({
      community: COMMUNITY,
      title: 'a post',
      body: 'Intro\n![first](image:1)\nOutro',
    })
    await form.attachments.add([
      imageFile('a.png', 'png'),
      imageFile('b.png', 'png'),
    ])

    await form.submit()

    const input = createPostInput()
    expect(input.embed).toEqual({
      $type: 'social.coves.embed.images',
      images: [
        {
          image: {
            $type: 'blob',
            ref: { $link: 'bafy-a.png' },
            mimeType: 'image/png',
            size: 64,
          },
          aspectRatio: { width: 300, height: 200 },
        },
        {
          image: {
            $type: 'blob',
            ref: { $link: 'bafy-b.png' },
            mimeType: 'image/png',
            size: 64,
          },
          aspectRatio: { width: 300, height: 200 },
        },
      ],
    })
    expect(input.content).toBe('Intro\nfirst\nOutro')
    expect(input.facets).toEqual([
      {
        index: { byteStart: 6, byteEnd: 11 },
        features: [{ $type: 'social.coves.richtext.facet#image', index: 0 }],
      },
    ])
  })
})
