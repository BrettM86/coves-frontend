/**
 * Test-only helpers for the image attachment browser suites. Not imported by
 * any shipped code: it lives here rather than in a `.test.ts` file so the
 * composer and optimistic-render suites can share it (vitest only collects
 * `*.test.ts`, so this file is never run as a suite of its own).
 */
import { vi } from 'vitest'
import type { UploadImageOutput } from '$lib/api/coves/types'

const ascii = (text: string): number[] =>
  [...text].map((character) => character.charCodeAt(0))

const MAGIC = {
  jpeg: [0xff, 0xd8, 0xff, 0xe0],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  webp: [...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WEBP')],
  gif: ascii('GIF89a'),
}

const TYPES = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** A small image file with real magic bytes, named so its object URL is too. */
export function imageFile(name: string, format: keyof typeof MAGIC): File {
  const bytes = new Uint8Array(64)
  bytes.set(MAGIC[format])
  return new File([bytes], name, { type: TYPES[format] })
}

/** One byte over the 10,000,000-byte limit. */
export const OVERSIZED_BYTES = 10_000_001

/**
 * An image file of {@link OVERSIZED_BYTES} bytes: real magic bytes, then
 * zero padding.
 */
export function oversizedImageFile(
  name: string,
  format: keyof typeof MAGIC,
): File {
  const bytes = new Uint8Array(OVERSIZED_BYTES)
  bytes.set(MAGIC[format])
  return new File([bytes], name, { type: TYPES[format] })
}

/**
 * Replaces jsdom's missing object URL functions: each file's URL is
 * `blob:http://localhost/<file name>`, and every revoked URL is recorded.
 */
export function stubObjectUrls(): { revoked: string[] } {
  const record = { revoked: [] as string[] }
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: (blob: Blob) =>
      `blob:http://localhost/${blob instanceof File ? blob.name : blob.size}`,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: (url: string) => {
      record.revoked.push(url)
    },
  })
  return record
}

/** jsdom cannot decode images: every image decodes to 640x480. */
export function stubImageDecoding(): void {
  vi.stubGlobal('createImageBitmap', async () => ({
    width: 640,
    height: 480,
    close: () => {},
  }))
}

/** Deliberately different from the decoded 640x480. */
export const UPLOAD_ASPECT_RATIO = { width: 300, height: 200 }

/** The upload response for a file: its blob ref is `bafy-<file name>`. */
export function uploadOutput(
  file: Blob,
  contentType: string,
): UploadImageOutput {
  const name = file instanceof File ? file.name : String(file.size)
  return {
    blob: {
      $type: 'blob',
      ref: { $link: `bafy-${name}` },
      mimeType: contentType,
      size: file.size,
    },
    mimeType: contentType,
    size: file.size,
    aspectRatio: UPLOAD_ASPECT_RATIO,
  }
}

/** Sets `files` on a file input and dispatches the `change` a pick fires. */
export function pickFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { configurable: true, value: files })
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Drops files on an element, as a bubbling `drop` carrying a dataTransfer. */
export function dropFiles(element: Element, files: File[]): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: { files, types: ['Files'] },
  })
  element.dispatchEvent(event)
  return event
}

/** Pastes files into an element, as a bubbling `paste` carrying clipboardData. */
export function pasteFiles(element: Element, files: File[]): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files,
      types: ['Files'],
      items: files.map((file) => ({
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
      })),
      getData: () => '',
    },
  })
  element.dispatchEvent(event)
  return event
}
