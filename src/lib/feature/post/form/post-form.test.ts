/**
 * The post form collects an NSFW toggle. This pins what that toggle has to
 * produce: a `com.atproto.label.defs#selfLabels` self-label on the created
 * record, no `labels` key at all when the toggle is off, and the same label on
 * the optimistic post view the create flow hands to the post page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatePostInput, UploadImageOutput } from '$lib/api/coves/types'
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

const uploadImage = vi.hoisted(() => vi.fn())

vi.mock('$lib/api/client.svelte', () => ({
  coves: () => ({ createPost, uploadImage }),
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

// ---------------------------------------------------------------------------
// Image attachments: uploads run before createPost, and createPost carries the
// attachment-derived embed. The full embed shape table is owned by
// attachments.test.ts; here it only has to reach createPost.
// ---------------------------------------------------------------------------

/** A JPEG of `size` bytes (real magic bytes) whose declared type lies. */
function jpegFile(size: number): Blob {
  const bytes = new Uint8Array(size)
  bytes.set([0xff, 0xd8, 0xff, 0xe0])
  return new Blob([bytes], { type: 'text/plain' })
}

function uploadOutput(file: Blob, contentType: string): UploadImageOutput {
  return {
    blob: {
      $type: 'blob',
      ref: { $link: `bafy-${file.size}` },
      mimeType: contentType,
      size: file.size,
    },
    mimeType: contentType,
    size: file.size,
    aspectRatio: { width: 300, height: 200 },
  }
}

type EmbedUnderTest = {
  $type?: string
  images?: { images?: { image?: { ref?: { $link?: string } } }[] }
  attachment?: unknown
}

describe('PostFormState image attachments', () => {
  let events: string[]

  beforeEach(() => {
    events = []
    createPost.mockClear()
    createPost.mockImplementation(async () => {
      events.push('createPost')
      return {
        uri: 'at://did:plc:author/social.coves.community.post/abc',
        cid: 'bafy...',
      }
    })
    uploadImage.mockReset()
    uploadImage.mockImplementation(async (file: Blob, contentType: string) => {
      events.push(`upload ${file.size}`)
      return uploadOutput(file, contentType)
    })
    // PostFormState has no decoder injection point: the default decoder reads
    // dimensions through the global createImageBitmap.
    vi.stubGlobal('createImageBitmap', async () => ({
      width: 640,
      height: 480,
      close() {},
    }))
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: (blob: Blob) => `blob:http://localhost/${blob.size}`,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: () => {},
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects and does not create the post when an image upload fails', async () => {
    const uploadError = new Error('upload failed')
    uploadImage.mockRejectedValue(uploadError)
    const form = new PostFormState({ community: COMMUNITY, title: 'a post' })
    await form.attachments.add([jpegFile(101)])

    await expect(form.submit()).rejects.toBe(uploadError)

    expect(createPost).not.toHaveBeenCalled()
  })

  it('uploads every image before creating the post with the attachment-derived embed', async () => {
    const form = new PostFormState({
      community: COMMUNITY,
      title: 'a post',
      url: 'https://example.com/story',
    })
    await form.attachments.add([jpegFile(101), jpegFile(102)])

    await form.submit()

    // Uploads start in strip order; createPost waits until both have finished.
    expect(events).toEqual(['upload 101', 'upload 102', 'createPost'])
    const embed = createPostInput().embed as EmbedUnderTest | undefined
    expect(embed?.$type).toBe('social.coves.embed.imagesWithAttachment')
    expect(
      embed?.images?.images?.map((entry) => entry.image?.ref?.$link),
    ).toEqual(['bafy-101', 'bafy-102'])
    expect(embed?.attachment).toEqual({
      $type: 'social.coves.embed.external',
      external: { uri: 'https://example.com/story' },
    })
  })

  it('creates the post exactly once when submit is retried after a partial upload failure', async () => {
    const uploadError = new Error('upload failed')
    uploadImage.mockImplementation(async (file: Blob, contentType: string) => {
      if (file.size === 102 && !events.includes('failed 102')) {
        events.push('failed 102')
        throw uploadError
      }
      return uploadOutput(file, contentType)
    })
    const form = new PostFormState({ community: COMMUNITY, title: 'a post' })
    await form.attachments.add([jpegFile(101), jpegFile(102)])

    await expect(form.submit()).rejects.toBe(uploadError)
    await form.submit()

    // createPostInput() asserts createPost was called exactly once.
    const embed = createPostInput().embed as
      | { $type?: string; images?: { image?: { ref?: { $link?: string } } }[] }
      | undefined
    expect(embed?.$type).toBe('social.coves.embed.images')
    expect(embed?.images?.map((entry) => entry.image?.ref?.$link)).toEqual([
      'bafy-101',
      'bafy-102',
    ])
  })

  it('rejects an image whose alt text is over the limit without uploading or creating the post', async () => {
    const form = new PostFormState({ community: COMMUNITY, title: 'a post' })
    await form.attachments.add([jpegFile(101)])
    form.attachments.setAlt(
      form.attachments.items[0]?.id ?? '',
      'a'.repeat(1001),
    )

    await expect(form.submit()).rejects.toThrow()

    expect(uploadImage).not.toHaveBeenCalled()
    expect(createPost).not.toHaveBeenCalled()
  })
  it('waits for an image still being checked, then creates the post once with it', async () => {
    let finishDecode: (() => void) | undefined
    vi.stubGlobal(
      'createImageBitmap',
      () =>
        new Promise((resolve) => {
          finishDecode = () => resolve({ width: 640, height: 480, close() {} })
        }),
    )
    const form = new PostFormState({ community: COMMUNITY, title: 'a post' })

    const adding = form.attachments.add([jpegFile(101)])
    await vi.waitFor(() => expect(finishDecode).toBeDefined())
    const submitting = form.submit()
    await new Promise((resolve) => setTimeout(resolve, 0))
    finishDecode?.()
    await adding

    await expect(submitting).resolves.toBeDefined()
    const embed = createPostInput().embed as EmbedUnderTest | undefined
    expect(embed?.$type).toBe('social.coves.embed.images')
    expect(
      (
        embed as { images?: { image?: { ref?: { $link?: string } } }[] }
      ).images?.map((entry) => entry.image?.ref?.$link),
    ).toEqual(['bafy-101'])
  })

  it('rejects with the abort reason and does not create the post when the signal aborts during an upload', async () => {
    let finishUpload: () => void = () => {}
    uploadImage.mockImplementation(
      (file: Blob, contentType: string) =>
        new Promise((resolve) => {
          finishUpload = () => resolve(uploadOutput(file, contentType))
        }),
    )
    const form = new PostFormState({ community: COMMUNITY, title: 'a post' })
    await form.attachments.add([jpegFile(101)])
    const controller = new AbortController()

    const submitting = form.submit(controller.signal).then(
      () => 'resolved',
      (error: unknown) => error,
    )
    await vi.waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(1))
    controller.abort()
    finishUpload()

    expect(await submitting).toBe(controller.signal.reason)
    expect(createPost).not.toHaveBeenCalled()
  })
})
