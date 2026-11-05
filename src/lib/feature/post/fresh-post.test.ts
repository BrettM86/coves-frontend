import { describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// `buildFreshPostView` reads the signed-in viewer off `profile.current`, whose
// real module touches localStorage at import time. Stub it to the one shape
// the builder needs: an authenticated viewer.
// ---------------------------------------------------------------------------

// Literals, not constants: the factory is hoisted above every declaration.
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: {
    current: {
      type: 'authenticated',
      did: 'did:plc:author',
      handle: 'mari.local.coves.dev',
      avatar: undefined,
    },
  },
}))

const VIEWER_DID = 'did:plc:author'

import type { AtUri, CID, CreatePostOutput } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import { buildFreshPostView } from './fresh-post'

const RKEY = '3lrkey'

const output: CreatePostOutput = {
  uri: `at://${VIEWER_DID}/social.coves.community.postv2/${RKEY}` as AtUri,
  cid: 'bafyreigh2akiscaildc' as CID,
}

// The community the create form was submitted against, exactly as the AppView
// serves it: a DNS handle *and* the structured `name` + `origin` pair.
const community = {
  did: 'did:plc:comm' as DID,
  handle: 'c-gardening.coves.social' as Handle,
  name: 'gardening',
  origin: 'coves.social',
}

describe('buildFreshPostView', () => {
  it('carries the community origin onto the optimistic view', () => {
    // The origin is what decides the community's canonical route param, so a
    // view that drops it addresses a different URL than the one the create
    // flow redirects to — and the one-shot stash is lost to that redirect.
    const view = buildFreshPostView({ output, community })

    expect(view?.community.origin).toBe('coves.social')
  })

  it('still carries the identifying community fields alongside it', () => {
    const view = buildFreshPostView({ output, community })

    expect(view?.community).toMatchObject({
      did: 'did:plc:comm',
      handle: 'c-gardening.coves.social',
      name: 'gardening',
    })
  })

  it('carries facets into the optimistic record', () => {
    // The page renders the optimistic view before the AppView indexes the
    // record, so it must carry the same facets the record was written with.
    const facets = [
      {
        index: { byteStart: 0, byteEnd: 5 },
        features: [{ $type: 'social.coves.richtext.facet#bold' }],
      },
    ]
    const view = buildFreshPostView({
      output,
      community,
      title: 'a post',
      content: 'hello world',
      facets,
    })

    expect(view?.record?.content).toBe('hello world')
    expect(view?.record?.facets).toEqual(facets)
  })
})

describe('buildFreshPostView attached images', () => {
  // The composer's preview URLs and the upload's aspect ratios, as the post
  // form hands them over after a successful submit.
  const images = [
    {
      previewUrl: 'blob:http://localhost/first',
      alt: 'a cat',
      aspectRatio: { width: 300, height: 200 },
    },
    {
      previewUrl: 'blob:http://localhost/second',
      aspectRatio: { width: 1000, height: 1500 },
    },
  ]

  const EXPECTED_IMAGE_VIEWS = [
    {
      thumb: 'blob:http://localhost/first',
      fullsize: 'blob:http://localhost/first',
      alt: 'a cat',
      aspectRatio: { width: 300, height: 200 },
    },
    {
      thumb: 'blob:http://localhost/second',
      fullsize: 'blob:http://localhost/second',
      aspectRatio: { width: 1000, height: 1500 },
    },
  ]

  it('renders 2 images and a URL as an imagesWithAttachment view of the preview URLs with a flattened external attachment', () => {
    const view = buildFreshPostView({
      output,
      community,
      title: 'a post',
      url: 'https://example.com/story',
      images,
    })

    expect(view?.embed).toEqual({
      $type: 'social.coves.embed.imagesWithAttachment#view',
      images: {
        $type: 'social.coves.embed.images#view',
        images: EXPECTED_IMAGE_VIEWS,
      },
      attachment: {
        $type: 'social.coves.embed.external#viewExternal',
        uri: 'https://example.com/story',
      },
    })
  })

  it('renders 2 images without a URL as an images view of the preview URLs', () => {
    const view = buildFreshPostView({
      output,
      community,
      title: 'a post',
      images,
    })

    expect(view?.embed).toEqual({
      $type: 'social.coves.embed.images#view',
      images: EXPECTED_IMAGE_VIEWS,
    })
  })
})
