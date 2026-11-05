/**
 * Every image-feature message a user can see comes from an en.json key, not a
 * source literal. The translator is mocked to echo the key, with its
 * interpolation params appended, so each assertion names the key it expects.
 * The English text at those keys is pinned by the real-translator suites
 * (image-file.test.ts, attachments.test.ts, post-form.test.ts,
 * comment-submit.test.ts and the composer browser tests).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DID, Handle } from '$lib/types/atproto'
import {
  imageFile,
  oversizedImageFile,
  stubImageDecoding,
  stubObjectUrls,
} from './test-helpers'

vi.mock('$lib/app/state/i18n', () => {
  const translate = (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${JSON.stringify(params)}` : key
  return {
    t: {
      get: translate,
      subscribe: (run: (translator: typeof translate) => void) => {
        run(translate)
        return () => {}
      },
    },
  }
})

// PostFormState reaches the API client and the auth state at import time;
// validate() needs neither.
vi.mock('$lib/api/client.svelte', () => ({ coves: () => ({}) }))
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: { current: { type: 'anonymous' }, isAuthenticated: false },
}))

const { checkImageFile } = await import('./image-file')
const { Attachments } = await import('./attachments.svelte')
const { PostFormState } =
  await import('$lib/feature/post/form/post-form.svelte')
const { CommentContentEmptyError } =
  await import('$lib/feature/comment/comment-submit')

const ascii = (text: string): number[] =>
  [...text].map((character) => character.charCodeAt(0))

/** A HEIC file: an ISO base media header with the heic brand at byte 8. */
function heicFile(): File {
  const bytes = new Uint8Array(32)
  bytes.set([0x00, 0x00, 0x00, 0x18, ...ascii('ftypheic')])
  return new File([bytes], 'photo.heic', { type: 'image/heic' })
}

const decodes =
  (width: number, height: number) =>
  async (): Promise<{ width: number; height: number }> => ({ width, height })

const decoderRejects = async (): Promise<{
  width: number
  height: number
}> => {
  throw new DOMException('The source image could not be decoded.')
}

beforeEach(() => {
  stubObjectUrls()
  stubImageDecoding()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('checkImageFile refusal messages', () => {
  it.each([
    {
      name: 'a text file typed image/jpeg',
      file: () => new File(['not an image'], 'a.jpg', { type: 'image/jpeg' }),
      decoder: decodes(640, 480),
      key: 'error.unsupported_image_format',
    },
    {
      name: 'a HEIC file',
      file: heicFile,
      decoder: decodes(640, 480),
      key: 'error.unsupported_image_format_convert',
    },
    {
      name: 'a JPEG the decoder cannot read',
      file: () => imageFile('a.jpg', 'jpeg'),
      decoder: decoderRejects,
      key: 'error.invalid_image',
    },
    {
      name: 'a JPEG over 10 MB',
      file: () => oversizedImageFile('a.jpg', 'jpeg'),
      decoder: decodes(640, 480),
      key: 'error.image_too_large',
    },
    {
      name: 'a GIF over 10 MB',
      file: () => oversizedImageFile('a.gif', 'gif'),
      decoder: decodes(640, 480),
      key: 'error.gif_too_large',
    },
    {
      name: 'a PNG over 50 million pixels',
      file: () => imageFile('a.png', 'png'),
      decoder: decodes(50_000_001, 1),
      key: 'error.image_dimensions_too_large',
    },
    {
      name: 'a GIF over 50 million pixels',
      file: () => imageFile('a.gif', 'gif'),
      decoder: decodes(8000, 7000),
      key: 'error.gif_dimensions_too_large',
    },
  ])('refuses $name with $key', async ({ file, decoder, key }) => {
    const check = await checkImageFile(file(), decoder)

    expect(check.ok ? 'accepted' : check.message).toBe(key)
  })
})

describe('Attachments over-8 refusal', () => {
  it.each([
    { target: 'post', key: 'error.too_many_images' },
    { target: 'comment', key: 'error.too_many_comment_images' },
  ] as const)(
    'refuses a ninth image in a $target composer with $key',
    async ({ target, key }) => {
      const attachments = new Attachments({
        target,
        decodeDimensions: decodes(640, 480),
      })
      await attachments.add(
        [1, 2, 3, 4, 5, 6, 7, 8].map((index) =>
          imageFile(`${index}.jpg`, 'jpeg'),
        ),
      )

      await attachments.add([imageFile('9.jpg', 'jpeg')])

      expect(attachments.items).toHaveLength(8)
      expect(attachments.message).toBe(key)
    },
  )
})

describe('PostFormState.validate alt text refusal', () => {
  it('names image 2 when its alt text is over the limit', async () => {
    const form = new PostFormState({
      community: {
        did: 'did:plc:community' as DID,
        handle: 'cats.test' as Handle,
        name: 'cats',
      },
      title: 'a post',
    })
    await form.attachments.add([
      imageFile('1.jpg', 'jpeg'),
      imageFile('2.jpg', 'jpeg'),
    ])
    form.attachments.setAlt(
      form.attachments.items[1]?.id ?? '',
      'a'.repeat(1001),
    )

    expect(form.validate()).toBe('form.post.altTextTooLong {"number":2}')
  })
})

describe('CommentContentEmptyError', () => {
  it('carries the comment.contentEmpty message', () => {
    expect(new CommentContentEmptyError().message).toBe('comment.contentEmpty')
  })
})
