import { describe, expect, it } from 'vitest'
import { checkAltText, checkImageFile } from './image-file'

const FORMAT_SENTENCE = 'Use a JPEG, PNG, WebP or GIF image.'
const CONVERT_SENTENCE = 'Convert it to JPEG first.'

/** Bytes as a Blob whose declared type deliberately lies. */
function blobOf(prefix: number[], type = 'text/plain', totalBytes?: number) {
  const bytes = new Uint8Array(totalBytes ?? prefix.length + 16)
  bytes.set(prefix)
  return new Blob([bytes], { type })
}

const ascii = (text: string): number[] =>
  [...text].map((character) => character.charCodeAt(0))

const JPEG = [0xff, 0xd8, 0xff, 0xe0]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const WEBP = [...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WEBP')]
const GIF87A = ascii('GIF87a')
const GIF89A = ascii('GIF89a')
const HEIC = [0x00, 0x00, 0x00, 0x18, ...ascii('ftypheic')]
const AVIF = [0x00, 0x00, 0x00, 0x1c, ...ascii('ftypavif')]

const decodes =
  (width: number, height: number) =>
  async (): Promise<{ width: number; height: number }> => ({ width, height })

describe('checkImageFile format sniffing', () => {
  it.each([
    ['JPEG', JPEG, 'image/jpeg'],
    ['PNG', PNG, 'image/png'],
    ['WebP', WEBP, 'image/webp'],
    ['GIF87a', GIF87A, 'image/gif'],
    ['GIF89a', GIF89A, 'image/gif'],
  ])(
    'takes the %s content type from the bytes, not the declared type',
    async (_name, prefix, contentType) => {
      expect(await checkImageFile(blobOf(prefix), decodes(640, 480))).toEqual({
        ok: true,
        contentType,
        width: 640,
        height: 480,
      })
    },
  )

  it.each([
    ['HEIC', HEIC],
    ['AVIF', AVIF],
  ])(
    'refuses %s and tells the user to convert it to JPEG',
    async (_name, prefix) => {
      const check = await checkImageFile(
        blobOf(prefix, 'image/heic'),
        decodes(640, 480),
      )

      expect(check).toMatchObject({ ok: false, code: 'UnsupportedImageFormat' })
      const message = check.ok ? '' : check.message
      expect(message).toContain(FORMAT_SENTENCE)
      expect(message).toContain(CONVERT_SENTENCE)
    },
  )

  it('refuses a text file typed image/jpeg with the format sentence only', async () => {
    const check = await checkImageFile(
      new Blob(['hello, this is not an image'], { type: 'image/jpeg' }),
      decodes(640, 480),
    )

    expect(check).toMatchObject({ ok: false, code: 'UnsupportedImageFormat' })
    const message = check.ok ? '' : check.message
    expect(message).toContain(FORMAT_SENTENCE)
    expect(message).not.toContain(CONVERT_SENTENCE)
  })
})

describe('checkImageFile size and pixel limits', () => {
  it('refuses a 10,000,001-byte JPEG and names the 10 MB limit', async () => {
    const check = await checkImageFile(
      blobOf(JPEG, 'image/jpeg', 10_000_001),
      decodes(640, 480),
    )

    expect(check).toMatchObject({ ok: false, code: 'ImageTooManyBytes' })
    expect(check.ok ? '' : check.message).toContain('10 MB')
  })

  it('accepts a JPEG of exactly 10,000,000 bytes', async () => {
    expect(
      await checkImageFile(
        blobOf(JPEG, 'image/jpeg', 10_000_000),
        decodes(640, 480),
      ),
    ).toEqual({ ok: true, contentType: 'image/jpeg', width: 640, height: 480 })
  })

  it('refuses an image that decodes to 50,000,001 pixels', async () => {
    expect(
      await checkImageFile(blobOf(PNG), decodes(50_000_001, 1)),
    ).toMatchObject({ ok: false, code: 'ImageTooManyPixels' })
  })

  it('accepts an image of exactly 50,000,000 pixels', async () => {
    expect(await checkImageFile(blobOf(PNG), decodes(10_000, 5_000))).toEqual({
      ok: true,
      contentType: 'image/png',
      width: 10_000,
      height: 5_000,
    })
  })
})

describe('checkImageFile read and decode failures', () => {
  const INVALID_IMAGE_MESSAGE =
    'This image could not be read. Try a different image.'

  it('refuses a file the decoder rejects as corrupt', async () => {
    const decoderRejects = async (): Promise<{
      width: number
      height: number
    }> => {
      throw new DOMException('The source image could not be decoded.')
    }

    expect(await checkImageFile(blobOf(JPEG), decoderRejects)).toEqual({
      ok: false,
      code: 'InvalidImage',
      message: INVALID_IMAGE_MESSAGE,
    })
  })

  it('refuses a file whose bytes cannot be read, even when the read rejects with null', async () => {
    const unreadable = blobOf(JPEG)
    unreadable.slice = () => {
      const part = new Blob([])
      part.arrayBuffer = () => Promise.reject(null)
      return part
    }

    expect(await checkImageFile(unreadable, decodes(640, 480))).toEqual({
      ok: false,
      code: 'InvalidImage',
      message: INVALID_IMAGE_MESSAGE,
    })
  })
})

describe('checkAltText', () => {
  it.each([
    ['1000 ASCII graphemes', 'a'.repeat(1000), { ok: true }],
    [
      '1001 ASCII graphemes',
      'a'.repeat(1001),
      { ok: false, code: 'AltTextTooManyGraphemes' },
    ],
    [
      '1000 family emoji (25,000 UTF-8 bytes)',
      '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'.repeat(1000),
      { ok: false, code: 'AltTextTooManyBytes' },
    ],
    [
      '1000 combining-accent graphemes (2000 UTF-16 units, 3000 bytes)',
      'é'.repeat(1000),
      { ok: true },
    ],
    [
      // 'e' + five U+0301 per grapheme: 6 UTF-16 units and 11 UTF-8 bytes,
      // so 1000 graphemes = 6000 UTF-16 units but 11,000 bytes.
      '1000 graphemes of e with five combining accents (6000 UTF-16 units, 11,000 bytes)',
      ('e' + '\u0301'.repeat(5)).repeat(1000),
      { ok: false, code: 'AltTextTooManyBytes' },
    ],
  ])('%s', (_name, alt, expected) => {
    expect(checkAltText(alt)).toEqual(expected)
  })
})
