import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { imageUrl } from '$lib/api/coves/image-proxy'
import { createLocalImageUrl, revokeLocalImageUrl } from './local-image-urls'

let revokedUrls: string[]

beforeEach(() => {
  const objectUrls = [
    'blob:http://localhost/first',
    'blob:http://localhost/second',
  ]
  revokedUrls = []
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: () => objectUrls.shift() ?? 'blob:http://localhost/exhausted',
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: (url: string) => {
      revokedUrls.push(url)
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const image = (url: string) => ({ thumb: url, fullsize: url })

describe('local image URL gate', () => {
  it('lets imageUrl return a URL made by createLocalImageUrl, and no other blob: URL', () => {
    const url = createLocalImageUrl(new Blob(['pixels'], { type: 'image/png' }))

    expect(imageUrl(image(url), 'thumb')).toBe('blob:http://localhost/first')
    expect(imageUrl(image(url), 'fullsize')).toBe('blob:http://localhost/first')
    expect(
      imageUrl(image('blob:http://localhost/never-created'), 'thumb'),
    ).toBeUndefined()
  })

  it('stops imageUrl returning a local URL once it is revoked, and releases the object URL', () => {
    const kept = createLocalImageUrl(new Blob(['one'], { type: 'image/png' }))
    const revoked = createLocalImageUrl(
      new Blob(['two'], { type: 'image/png' }),
    )
    expect(imageUrl(image(revoked))).toBe('blob:http://localhost/second')

    revokeLocalImageUrl(revoked)

    expect(imageUrl(image(revoked))).toBeUndefined()
    expect(imageUrl(image(kept))).toBe('blob:http://localhost/first')
    expect(revokedUrls).toEqual(['blob:http://localhost/second'])
  })
})
