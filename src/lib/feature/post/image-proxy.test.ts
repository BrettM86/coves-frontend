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
  it('returns thumb when available for thumb variant', () => {
    const img: EmbedImage = {
      image: 'https://original.com/pic.jpg',
      thumb: 'https://proxy.com/img/content_preview/plain/did:plc:a/baf1',
      fullsize: 'https://proxy.com/img/content_full/plain/did:plc:a/baf1',
    }
    expect(imageUrl(img, 'thumb')).toBe(img.thumb)
  })

  it('returns fullsize when available for fullsize variant', () => {
    const img: EmbedImage = {
      image: 'https://original.com/pic.jpg',
      thumb: 'https://proxy.com/img/content_preview/plain/did:plc:a/baf1',
      fullsize: 'https://proxy.com/img/content_full/plain/did:plc:a/baf1',
    }
    expect(imageUrl(img, 'fullsize')).toBe(img.fullsize)
  })

  it('falls back to image when thumb is undefined', () => {
    const img: EmbedImage = { image: 'https://original.com/pic.jpg' }
    expect(imageUrl(img, 'thumb')).toBe(img.image)
  })

  it('falls back to image when fullsize is undefined', () => {
    const img: EmbedImage = { image: 'https://original.com/pic.jpg' }
    expect(imageUrl(img, 'fullsize')).toBe(img.image)
  })

  it('defaults to thumb variant', () => {
    const img: EmbedImage = {
      image: 'https://original.com/pic.jpg',
      thumb: 'https://proxy.com/thumb',
    }
    expect(imageUrl(img)).toBe(img.thumb)
  })

  it('falls back to image when thumb is empty string', () => {
    const img: EmbedImage = {
      image: 'https://original.com/pic.jpg',
      thumb: '',
    }
    expect(imageUrl(img, 'thumb')).toBe(img.image)
  })

  it('falls back to image when fullsize is empty string', () => {
    const img: EmbedImage = {
      image: 'https://original.com/pic.jpg',
      fullsize: '',
    }
    expect(imageUrl(img, 'fullsize')).toBe(img.image)
  })
})
