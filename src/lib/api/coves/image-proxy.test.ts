import { describe, it, expect } from 'vitest'
import type { EmbedImage } from '$lib/api/coves/types'
import { parseProxyUrl, withPreset, imageUrl } from './image-proxy'

describe('parseProxyUrl', () => {
  it('parses a relative proxy URL', () => {
    const result = parseProxyUrl(
      '/img/avatar_small/plain/did:plc:abc123/bafkrei456',
    )
    expect(result).toEqual({
      preset: 'avatar_small',
      did: 'did:plc:abc123',
      cid: 'bafkrei456',
    })
  })

  it('parses a full proxy URL with base domain', () => {
    const result = parseProxyUrl(
      'https://coves.social/img/content_full/plain/did:plc:xyz/bafyrei789',
    )
    expect(result).toEqual({
      preset: 'content_full',
      did: 'did:plc:xyz',
      cid: 'bafyrei789',
    })
  })

  it('returns null for non-proxy URLs', () => {
    expect(parseProxyUrl('https://example.com/image.jpg')).toBeNull()
    expect(parseProxyUrl('')).toBeNull()
    expect(parseProxyUrl('not-a-url')).toBeNull()
  })

  it('returns null for PDS blob URLs', () => {
    expect(
      parseProxyUrl(
        'https://pds.example.com/xrpc/com.atproto.sync.getBlob?did=abc&cid=xyz',
      ),
    ).toBeNull()
  })

  it('parses a proxy URL with did:web: DID method', () => {
    const result = parseProxyUrl(
      'https://coves.social/img/avatar/plain/did:web:example.com/bafkrei456',
    )
    expect(result).toEqual({
      preset: 'avatar',
      did: 'did:web:example.com',
      cid: 'bafkrei456',
    })
  })
})

describe('withPreset', () => {
  it('swaps preset on a relative proxy URL', () => {
    expect(
      withPreset('/img/avatar_small/plain/did:plc:abc/bafkrei123', 'avatar'),
    ).toBe('/img/avatar/plain/did:plc:abc/bafkrei123')
  })

  it('swaps preset on a full proxy URL', () => {
    expect(
      withPreset(
        'https://coves.social/img/content_preview/plain/did:plc:xyz/bafyrei456',
        'content_full',
      ),
    ).toBe('https://coves.social/img/content_full/plain/did:plc:xyz/bafyrei456')
  })

  it('returns non-proxy URLs unchanged', () => {
    const pdsUrl =
      'https://pds.example.com/xrpc/com.atproto.sync.getBlob?did=abc&cid=xyz'
    expect(withPreset(pdsUrl, 'content_full')).toBe(pdsUrl)
  })

  it('returns empty string unchanged', () => {
    expect(withPreset('', 'avatar')).toBe('')
  })

  it('strips query strings when swapping preset', () => {
    const url =
      'https://coves.social/img/avatar/plain/did:plc:abc/bafkrei123?format=webp'
    const result = withPreset(url, 'content_full')
    expect(result).toBe(
      'https://coves.social/img/content_full/plain/did:plc:abc/bafkrei123',
    )
  })
})

describe('imageUrl', () => {
  const THUMB = 'https://proxy.com/img/content_preview/plain/did:plc:a/baf1'
  const FULLSIZE = 'https://proxy.com/img/content_full/plain/did:plc:a/baf1'

  it('returns thumb when available for thumb variant', () => {
    const img: EmbedImage = { thumb: THUMB, fullsize: FULLSIZE }
    expect(imageUrl(img, 'thumb')).toBe(
      'https://proxy.com/img/content_preview/plain/did:plc:a/baf1',
    )
  })

  it('returns fullsize when available for fullsize variant', () => {
    const img: EmbedImage = { thumb: THUMB, fullsize: FULLSIZE }
    expect(imageUrl(img, 'fullsize')).toBe(
      'https://proxy.com/img/content_full/plain/did:plc:a/baf1',
    )
  })

  it('defaults to thumb variant', () => {
    const img: EmbedImage = { thumb: 'https://proxy.com/thumb' }
    expect(imageUrl(img)).toBe('https://proxy.com/thumb')
  })

  it('returns a local dev http://localhost proxy URL unchanged', () => {
    const img: EmbedImage = {
      thumb: 'http://localhost:8081/img/content_preview/plain/did:plc:a/baf1',
      fullsize: 'http://localhost:8081/img/content_full/plain/did:plc:a/baf1',
    }
    expect(imageUrl(img, 'thumb')).toBe(
      'http://localhost:8081/img/content_preview/plain/did:plc:a/baf1',
    )
    expect(imageUrl(img, 'fullsize')).toBe(
      'http://localhost:8081/img/content_full/plain/did:plc:a/baf1',
    )
  })

  it.each<[string, EmbedImage, 'thumb' | 'fullsize']>([
    [
      'javascript: fullsize',
      { thumb: THUMB, fullsize: 'javascript:alert(1)' },
      'fullsize',
    ],
    [
      'data: thumb',
      { thumb: 'data:image/png;base64,AAAA', fullsize: FULLSIZE },
      'thumb',
    ],
    ['empty thumb', { thumb: '', fullsize: FULLSIZE }, 'thumb'],
    ['empty fullsize', { thumb: THUMB, fullsize: '' }, 'fullsize'],
    ['missing thumb', { fullsize: FULLSIZE }, 'thumb'],
    ['missing fullsize (only a valid thumb)', { thumb: THUMB }, 'fullsize'],
    [
      'blob: fullsize in a server view',
      { thumb: THUMB, fullsize: 'blob:https://coves.test/uuid' },
      'fullsize',
    ],
    [
      'blob: thumb in a server view',
      { thumb: 'blob:https://coves.test/uuid', fullsize: FULLSIZE },
      'thumb',
    ],
  ])('returns undefined for %s', (_label, img, variant) => {
    expect(imageUrl(img, variant)).toBeUndefined()
  })

  it.each<['thumb' | 'fullsize']>([['thumb'], ['fullsize']])(
    'never returns a stray raw image property for the %s variant',
    (variant) => {
      // A server object carrying the removed `image` field must not leak it.
      const img = {
        image: 'https://original.com/pic.jpg',
      } as unknown as EmbedImage
      expect(imageUrl(img, variant)).toBeUndefined()
    },
  )
})
