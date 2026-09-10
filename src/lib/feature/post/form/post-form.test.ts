/**
 * The post form collects an NSFW toggle. This pins what that toggle has to
 * produce: a `com.atproto.label.defs#selfLabels` self-label on the created
 * record, no `labels` key at all when the toggle is off, and the same label on
 * the optimistic post view the create flow hands to the post page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatePostInput } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'

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

vi.mock('$lib/api/client.svelte', () => ({
  coves: () => ({ createPost }),
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

import { hasNSFWLabel } from '$lib/feature/post/content-labels'
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

describe('PostFormState NSFW self-labelling', () => {
  beforeEach(() => {
    createPost.mockClear()
  })

  it('sends a nsfw self-label when the NSFW toggle is on', async () => {
    const form = new PostFormState({ community: COMMUNITY, title: 'a post' })
    form.nsfw = true

    await form.submit()

    expect(createPostInput().labels).toEqual({
      $type: 'com.atproto.label.defs#selfLabels',
      values: [{ val: 'nsfw' }],
    })
  })

  it('omits the labels key entirely when the NSFW toggle is off', async () => {
    const form = new PostFormState({ community: COMMUNITY, title: 'a post' })
    form.nsfw = false

    await form.submit()

    // Asserted on the keys, not the value: this pins that no label is sent at
    // all when the toggle is off, which a `toEqual(undefined)` value match
    // would not distinguish from an explicitly-undefined `labels` key.
    expect(Object.keys(createPostInput())).not.toContain('labels')
  })

  it('carries the nsfw label on the optimistic post view', async () => {
    const form = new PostFormState({ community: COMMUNITY, title: 'a post' })
    form.nsfw = true

    const result = await form.submit()

    const record = result.post?.record
    expect(record).toBeDefined()
    expect(hasNSFWLabel(record?.labels)).toBe(true)
  })

  it('leaves the optimistic post view unlabelled when the toggle is off', async () => {
    const form = new PostFormState({ community: COMMUNITY, title: 'a post' })
    form.nsfw = false

    const result = await form.submit()

    const record = result.post?.record
    expect(record).toBeDefined()
    expect(hasNSFWLabel(record?.labels)).toBe(false)
  })

  it('keeps the label the request was sent with when the toggle is flipped mid-flight', async () => {
    // The toggle is a live form field: nothing stops the author (or a reset)
    // from changing it while the create request is in flight. The submitted
    // record is already labelled, so the optimistic view has to match what was
    // sent, not whatever the form says by the time the promise settles.
    let release: (value: { uri: string; cid: string }) => void = () => {}
    createPost.mockImplementationOnce(
      () =>
        new Promise<{ uri: string; cid: string }>((resolve) => {
          release = resolve
        }),
    )

    const form = new PostFormState({ community: COMMUNITY, title: 'a post' })
    form.nsfw = true

    const pending = form.submit()
    await vi.waitFor(() => expect(createPost).toHaveBeenCalledTimes(1))

    form.nsfw = false
    release({
      uri: 'at://did:plc:author/social.coves.community.post/abc',
      cid: 'bafy...',
    })

    const result = await pending

    expect(hasNSFWLabel(createPostInput().labels)).toBe(true)
    expect(hasNSFWLabel(result.post?.record?.labels)).toBe(true)
  })
})
