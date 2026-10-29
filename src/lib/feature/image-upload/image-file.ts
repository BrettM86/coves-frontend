export type ImageContentType =
  'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

export const MAXIMUM_IMAGE_BYTES = 10_000_000
export const MAXIMUM_IMAGE_PIXELS = 50_000_000
export const MAXIMUM_ALT_TEXT_GRAPHEMES = 1000
export const MAXIMUM_ALT_TEXT_BYTES = 10_000

export type ImageFileCheck =
  | { ok: true; contentType: ImageContentType; width: number; height: number }
  | {
      ok: false
      code: 'ImageTooManyBytes' | 'ImageTooManyPixels'
      /** The sniffed format, so an oversized image can be re-encoded. */
      contentType: ImageContentType
      message: string
    }
  | {
      ok: false
      code: 'UnsupportedImageFormat' | 'InvalidImage'
      message: string
    }

export type AltTextCheck =
  | { ok: true }
  | { ok: false; code: 'AltTextTooManyGraphemes' | 'AltTextTooManyBytes' }

const FORMAT_MESSAGE = 'Use a JPEG, PNG, WebP or GIF image.'
const CONVERT_MESSAGE = 'Convert it to JPEG first.'
export const INVALID_IMAGE = {
  ok: false,
  code: 'InvalidImage',
  message: 'This image could not be read. Try a different image.',
} as const satisfies ImageFileCheck

/** Enough leading bytes to recognise every format below. */
const SNIFF_BYTES = 16

function startsWith(bytes: Uint8Array, prefix: number[], at = 0): boolean {
  return prefix.every((byte, index) => bytes[at + index] === byte)
}

const ascii = (text: string): number[] =>
  [...text].map((character) => character.charCodeAt(0))

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** ISO base media brands of HEIC/HEIF and AVIF files, read at byte 8. */
const CONVERTIBLE_BRANDS = [
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
  'avif',
  'avis',
]

/** The image type the bytes say, 'convertible' for HEIC/AVIF, or undefined. */
function sniff(
  bytes: Uint8Array,
): ImageContentType | 'convertible' | undefined {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png'
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8))
    return 'image/webp'
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a')))
    return 'image/gif'
  if (
    startsWith(bytes, ascii('ftyp'), 4) &&
    CONVERTIBLE_BRANDS.some((brand) => startsWith(bytes, ascii(brand), 8))
  )
    return 'convertible'
  return undefined
}

/**
 * The bytes of `blob`. Browsers and Node give Blob an `arrayBuffer` method;
 * jsdom's Blob (the composer's component tests) has only FileReader.
 */
function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result)
      else reject(new Error('The image file could not be read'))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

async function decodeWithImageBitmap(
  file: Blob,
): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const dimensions = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return dimensions
}

/**
 * Checks a picked file before upload: its format from its first bytes (never
 * its declared type), then its byte size, then its decoded pixel count. A file
 * that cannot be read or decoded is refused as InvalidImage, never thrown.
 */
export async function checkImageFile(
  file: Blob,
  decodeDimensions: (
    file: Blob,
  ) => Promise<{ width: number; height: number }> = decodeWithImageBitmap,
): Promise<ImageFileCheck> {
  let head: Uint8Array
  try {
    head = new Uint8Array(await readBytes(file.slice(0, SNIFF_BYTES)))
  } catch {
    return INVALID_IMAGE
  }
  const sniffed = sniff(head)
  if (sniffed === undefined || sniffed === 'convertible') {
    return {
      ok: false,
      code: 'UnsupportedImageFormat',
      message:
        sniffed === 'convertible'
          ? `${FORMAT_MESSAGE} ${CONVERT_MESSAGE}`
          : FORMAT_MESSAGE,
    }
  }
  if (file.size > MAXIMUM_IMAGE_BYTES) {
    return {
      ok: false,
      code: 'ImageTooManyBytes',
      contentType: sniffed,
      message:
        sniffed === 'image/gif'
          ? 'This GIF is larger than 10 MB. To keep their animation, animated GIFs must be under 10 MB.'
          : 'This image is larger than 10 MB. Use a smaller image.',
    }
  }
  let dimensions: { width: number; height: number }
  try {
    dimensions = await decodeDimensions(file)
  } catch {
    return INVALID_IMAGE
  }
  const { width, height } = dimensions
  if (width * height > MAXIMUM_IMAGE_PIXELS) {
    return {
      ok: false,
      code: 'ImageTooManyPixels',
      contentType: sniffed,
      message:
        sniffed === 'image/gif'
          ? 'This GIF has more than 50 million pixels. To keep their animation, animated GIFs must be under 50 million pixels.'
          : 'This image has more than 50 million pixels. Use a smaller image.',
    }
  }
  return { ok: true, contentType: sniffed, width, height }
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const utf8 = new TextEncoder()

/** The number of user-perceived characters in `text`. */
export function countGraphemes(text: string): number {
  return [...graphemes.segment(text)].length
}

/** Alt text may hold at most 1000 graphemes and 10,000 UTF-8 bytes. */
export function checkAltText(alt: string): AltTextCheck {
  if (countGraphemes(alt) > MAXIMUM_ALT_TEXT_GRAPHEMES)
    return { ok: false, code: 'AltTextTooManyGraphemes' }
  if (utf8.encode(alt).length > MAXIMUM_ALT_TEXT_BYTES)
    return { ok: false, code: 'AltTextTooManyBytes' }
  return { ok: true }
}
