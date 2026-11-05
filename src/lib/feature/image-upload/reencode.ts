import { log } from '$lib/app/util/log'
import {
  checkImageFile,
  type ImageContentType,
  type ImageFileCheck,
} from './image-file'

export const MAXIMUM_REENCODED_EDGE = 4096
const JPEG_QUALITY = 0.9

export type ReencodableContentType = 'image/jpeg' | 'image/png' | 'image/webp'

type DecodeDimensions = (
  file: Blob,
) => Promise<{ width: number; height: number }>

export type Reencode = (
  file: Blob,
  contentType: ReencodableContentType,
) => Promise<Blob>

export type PreparedImageFile =
  | {
      ok: true
      file: Blob
      contentType: ImageContentType
      width: number
      height: number
    }
  | Exclude<ImageFileCheck, { ok: true }>

type Surface = {
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  encode: (type: string, quality?: number) => Promise<Blob>
}

function createSurface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('A 2D canvas is not available')
    return {
      context,
      encode: (type, quality) => canvas.convertToBlob({ type, quality }),
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('A 2D canvas is not available')
  return {
    context,
    encode: (type, quality) =>
      new Promise((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error('Encoding failed')),
          type,
          quality,
        ),
      ),
  }
}

function hasTransparency(
  context: Surface['context'],
  width: number,
  height: number,
): boolean {
  const { data } = context.getImageData(0, 0, width, height)
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] !== 255) return true
  }
  return false
}

/**
 * Decodes `file` and encodes it again with its long edge at most 4096:
 * as PNG when a PNG or WebP source has any transparent pixel, otherwise as
 * JPEG at quality 0.9.
 */
export async function reencodeImage(
  file: Blob,
  contentType: ReencodableContentType,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(
      1,
      MAXIMUM_REENCODED_EDGE / Math.max(bitmap.width, bitmap.height),
    )
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const surface = createSurface(width, height)
    surface.context.imageSmoothingEnabled = true
    surface.context.imageSmoothingQuality = 'high'
    surface.context.drawImage(bitmap, 0, 0, width, height)
    const transparent =
      contentType !== 'image/jpeg' &&
      hasTransparency(surface.context, width, height)
    return transparent
      ? await surface.encode('image/png')
      : await surface.encode('image/jpeg', JPEG_QUALITY)
  } finally {
    bitmap.close()
  }
}

/**
 * Checks a picked file; a JPEG, PNG or WebP over the byte or pixel limit is
 * re-encoded and checked again. GIFs are never re-encoded (they would lose
 * their animation). A failed re-encode is logged and refused with the
 * original size or pixel message, since the fix is a smaller image.
 */
export async function prepareImageFile(
  file: Blob,
  options: { decodeDimensions?: DecodeDimensions; reencode?: Reencode } = {},
): Promise<PreparedImageFile> {
  const { decodeDimensions, reencode = reencodeImage } = options
  const check = await checkImageFile(file, decodeDimensions)
  if (check.ok) return { ...check, file }
  if (
    (check.code !== 'ImageTooManyBytes' &&
      check.code !== 'ImageTooManyPixels') ||
    check.contentType === 'image/gif'
  )
    return check
  let reencoded: Blob
  try {
    reencoded = await reencode(file, check.contentType)
  } catch (error) {
    log.warn('Image re-encode failed', error, {
      contentType: check.contentType,
      size: file.size,
    })
    return check
  }
  const recheck = await checkImageFile(reencoded, decodeDimensions)
  return recheck.ok ? { ...recheck, file: reencoded } : recheck
}
