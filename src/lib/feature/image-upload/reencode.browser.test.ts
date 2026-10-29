// @vitest-environment jsdom
/**
 * Oversized JPEG, PNG and WebP picks are re-encoded in the browser with the
 * long edge capped at 4096, through `Attachments.add` and its default
 * re-encoder. jsdom has no image decoding or canvas, so the platform is faked:
 * - `createImageBitmap` reports the dimensions (and transparency) registered
 *   for the Blob it is given; every encoded output registers its canvas size.
 * - a 2D context records each `drawImage` call, with the smoothing settings
 *   in force at that call, and answers `getImageData`
 *   with opaque RGBA pixels, except one pixel (not the first) at alpha 254
 *   when a transparent source was drawn on that canvas.
 * - `OffscreenCanvas.convertToBlob` and the `<canvas>` fallback's `toBlob`
 *   return a Blob of the requested type starting with its real magic bytes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Attachments } from './attachments.svelte'
import { imageFile, oversizedImageFile, stubObjectUrls } from './test-helpers'

type Format = 'jpeg' | 'png' | 'webp'

interface Registered {
  width: number
  height: number
  transparent: boolean
}

interface FakeBitmap extends Registered {
  close: () => void
}

interface Surface {
  width: number
  height: number
}

interface Encoded {
  type: string
  quality: number | undefined
  width: number
  height: number
  draws: unknown[][]
  smoothing: Smoothing[]
}

interface Smoothing {
  enabled: boolean
  quality: string
}

const MAGIC: Record<string, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/webp': [
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ],
}

/** The pixel, by index, that is semi-transparent in a transparent drawing. */
const TRANSPARENT_PIXEL = 5

let registry: Map<Blob, Registered>
let draws: Map<Surface, unknown[][]>
let smoothings: Map<Surface, Smoothing[]>
let encoded: Encoded[]

function register(blob: Blob, image: Registered): void {
  registry.set(blob, image)
}

function fakeContext(surface: Surface) {
  const drawn = draws.get(surface) ?? []
  draws.set(surface, drawn)
  const smoothing = smoothings.get(surface) ?? []
  smoothings.set(surface, smoothing)
  const context = {
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    fillStyle: '#000000',
    fillRect: () => {},
    clearRect: () => {},
    drawImage: (...args: unknown[]) => {
      drawn.push(args)
      smoothing.push({
        enabled: context.imageSmoothingEnabled,
        quality: context.imageSmoothingQuality,
      })
    },
    getImageData: (_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4).fill(255)
      const transparent = drawn.some(
        (args) => (args[0] as Partial<FakeBitmap>).transparent === true,
      )
      if (transparent && width * height > TRANSPARENT_PIXEL)
        data[TRANSPARENT_PIXEL * 4 + 3] = 254
      return { data, width, height, colorSpace: 'srgb' }
    },
  }
  return context
}

function encode(surface: Surface, type = 'image/png', quality?: number): Blob {
  const bytes = new Uint8Array(2048)
  bytes.set(MAGIC[type] ?? [])
  const blob = new Blob([bytes], { type })
  register(blob, {
    width: surface.width,
    height: surface.height,
    transparent: false,
  })
  encoded.push({
    type,
    quality,
    width: surface.width,
    height: surface.height,
    draws: draws.get(surface) ?? [],
    smoothing: smoothings.get(surface) ?? [],
  })
  return blob
}

class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}

  getContext(kind: string) {
    return kind === '2d' ? fakeContext(this) : null
  }

  async convertToBlob(options?: { type?: string; quality?: number }) {
    return encode(this, options?.type, options?.quality)
  }
}

async function fakeCreateImageBitmap(source: unknown): Promise<FakeBitmap> {
  const image = source instanceof Blob ? registry.get(source) : undefined
  if (!image) throw new Error('The fake cannot decode this source')
  return { ...image, close: () => {} }
}

function stubPlatform({ offscreen }: { offscreen: boolean }): void {
  vi.stubGlobal('createImageBitmap', fakeCreateImageBitmap)
  vi.stubGlobal('OffscreenCanvas', offscreen ? FakeOffscreenCanvas : undefined)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    function (this: HTMLCanvasElement, kind: string) {
      return (kind === '2d'
        ? fakeContext(this)
        : null) as unknown as RenderingContext
    },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
    quality?: number,
  ) {
    callback(encode(this, type, quality))
  })
}

/** The first `count` bytes of a Blob (jsdom's Blob has no arrayBuffer). */
function firstBytes(blob: Blob, count: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer)
        resolve([...new Uint8Array(reader.result)])
      else reject(new Error('Expected an ArrayBuffer'))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob.slice(0, count))
  })
}

/**
 * Each draw as the source size, the source rectangle and the destination
 * rectangle, whichever drawImage form was used.
 */
function normalizedDraws(args: unknown[][]) {
  return args.map((call) => {
    const source = call[0] as Partial<FakeBitmap>
    const size = { width: source.width, height: source.height }
    const numbers = call.slice(1) as number[]
    if (numbers.length === 8) {
      return {
        source: size,
        sourceRect: numbers.slice(0, 4),
        destination: numbers.slice(4),
      }
    }
    return {
      source: size,
      sourceRect: [0, 0, source.width, source.height],
      destination:
        numbers.length === 4
          ? numbers
          : [...numbers, source.width, source.height],
    }
  })
}

function expectWithinOne(actual: number | undefined, expected: number): void {
  expect(actual).toBeGreaterThanOrEqual(expected - 1)
  expect(actual).toBeLessThanOrEqual(expected + 1)
}

interface Row {
  name: string
  format: Format
  oversizedBytes: boolean
  width: number
  height: number
  transparent: boolean
  offscreen: boolean
  expectedType: 'image/jpeg' | 'image/png'
  expectedWidth: number
  expectedHeight: number
}

/**
 * Picks the described image with the default re-encoder and asserts the
 * attached file is the expected format and size, with the whole source drawn
 * into the whole canvas (no crop) at high-quality smoothing.
 */
async function pickAndExpect(row: Row): Promise<void> {
  stubPlatform({ offscreen: row.offscreen })
  const file = row.oversizedBytes
    ? oversizedImageFile(`${row.name}.${row.format}`, row.format)
    : imageFile(`${row.name}.${row.format}`, row.format)
  register(file, {
    width: row.width,
    height: row.height,
    transparent: row.transparent,
  })
  const attachments = new Attachments()

  await attachments.add([file])

  expect(attachments.message).toBeUndefined()
  expect(attachments.items).toHaveLength(1)
  const item = attachments.items[0]
  expect(item?.contentType).toBe(row.expectedType)
  expect(item?.file.type).toBe(row.expectedType)
  const magic = MAGIC[row.expectedType] ?? []
  expect(await firstBytes(item?.file ?? new Blob(), magic.length)).toEqual(
    magic,
  )

  expect(encoded).toHaveLength(1)
  const output = encoded[0]
  expect(output?.type).toBe(row.expectedType)
  if (row.expectedType === 'image/jpeg') expect(output?.quality).toBe(0.9)
  expectWithinOne(output?.width, row.expectedWidth)
  expectWithinOne(output?.height, row.expectedHeight)
  expect(normalizedDraws(output?.draws ?? [])).toEqual([
    {
      source: { width: row.width, height: row.height },
      sourceRect: [0, 0, row.width, row.height],
      destination: [0, 0, output?.width, output?.height],
    },
  ])
  expect(output?.smoothing).toEqual([{ enabled: true, quality: 'high' }])
}

beforeEach(() => {
  registry = new Map()
  draws = new Map()
  smoothings = new Map()
  encoded = []
  stubObjectUrls()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('re-encoding an opaque oversized PNG or WebP', () => {
  it.each<Row>([
    {
      name: 'landscape opaque PNG over 10,000,000 bytes',
      format: 'png',
      oversizedBytes: true,
      width: 6000,
      height: 4000,
      transparent: false,
      offscreen: true,
      expectedType: 'image/jpeg',
      expectedWidth: 4096,
      expectedHeight: 2731,
    },
    {
      name: 'portrait opaque PNG over 10,000,000 bytes',
      format: 'png',
      oversizedBytes: true,
      width: 2000,
      height: 9000,
      transparent: false,
      offscreen: true,
      expectedType: 'image/jpeg',
      expectedWidth: 910,
      expectedHeight: 4096,
    },
    {
      name: 'opaque WebP over 10,000,000 bytes',
      format: 'webp',
      oversizedBytes: true,
      width: 6000,
      height: 4000,
      transparent: false,
      offscreen: true,
      expectedType: 'image/jpeg',
      expectedWidth: 4096,
      expectedHeight: 2731,
    },
  ])(
    'attaches a $name as a JPEG at quality 0.9 with its long edge at 4096',
    pickAndExpect,
  )

  it('attaches an opaque 3000x2000 PNG over 10,000,000 bytes as a JPEG at its own size, never upscaled', () =>
    pickAndExpect({
      name: 'opaque 3000x2000 PNG over 10,000,000 bytes',
      format: 'png',
      oversizedBytes: true,
      width: 3000,
      height: 2000,
      transparent: false,
      offscreen: true,
      expectedType: 'image/jpeg',
      expectedWidth: 3000,
      expectedHeight: 2000,
    }))
})

describe('re-encoding a transparent oversized PNG or WebP', () => {
  it.each<Row>([
    {
      name: 'PNG of 8000x7000 with one semi-transparent pixel',
      format: 'png',
      oversizedBytes: false,
      width: 8000,
      height: 7000,
      transparent: true,
      offscreen: true,
      expectedType: 'image/png',
      expectedWidth: 4096,
      expectedHeight: 3584,
    },
    {
      name: 'WebP of 8000x7000 with one semi-transparent pixel',
      format: 'webp',
      oversizedBytes: false,
      width: 8000,
      height: 7000,
      transparent: true,
      offscreen: true,
      expectedType: 'image/png',
      expectedWidth: 4096,
      expectedHeight: 3584,
    },
  ])('attaches a $name as a PNG with its long edge at 4096', pickAndExpect)
})

describe('re-encoding a JPEG over 50,000,000 pixels', () => {
  it.each<Row>([
    {
      name: 'with OffscreenCanvas',
      format: 'jpeg',
      oversizedBytes: false,
      width: 8000,
      height: 7000,
      transparent: true,
      offscreen: true,
      expectedType: 'image/jpeg',
      expectedWidth: 4096,
      expectedHeight: 3584,
    },
    {
      name: 'without OffscreenCanvas, through a canvas element',
      format: 'jpeg',
      oversizedBytes: false,
      width: 8000,
      height: 7000,
      transparent: true,
      offscreen: false,
      expectedType: 'image/jpeg',
      expectedWidth: 4096,
      expectedHeight: 3584,
    },
  ])(
    'attaches an 8000x7000 JPEG as a 4096x3584 JPEG even when its pixels report transparency, $name',
    pickAndExpect,
  )
})
