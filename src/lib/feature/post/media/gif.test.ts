import { describe, expect, it } from 'vitest'
import { gifBlobCids, isGifImage } from './gif'

const blob = (cid: string, mimeType: string) => ({
  $type: 'blob',
  ref: { $link: cid },
  mimeType,
  size: 10,
})

describe('gifBlobCids', () => {
  it('collects the GIF blobs of an images record', () => {
    const embed = {
      $type: 'social.coves.embed.images',
      images: [
        { image: blob('bafygif', 'image/gif') },
        { image: blob('bafyjpg', 'image/jpeg') },
      ],
    }
    expect([...gifBlobCids(embed)]).toEqual(['bafygif'])
  })

  it('reads the images of an imagesWithAttachment record', () => {
    const embed = {
      $type: 'social.coves.embed.imagesWithAttachment',
      images: { images: [{ image: blob('bafygif2', 'image/gif') }] },
    }
    expect([...gifBlobCids(embed)]).toEqual(['bafygif2'])
  })

  it.each([
    undefined,
    null,
    'x',
    { $type: 'social.coves.embed.external' },
    { $type: 'social.coves.embed.images', images: 'nope' },
    {
      $type: 'social.coves.embed.images',
      images: [{ image: { mimeType: 'image/gif' } }],
    },
  ])('finds nothing in %j', (embed) => {
    expect(gifBlobCids(embed).size).toBe(0)
  })

  it('skips a null image entry', () => {
    const embed = { $type: 'social.coves.embed.images', images: [null] }
    expect(() => gifBlobCids(embed)).not.toThrow()
    expect(gifBlobCids(embed).size).toBe(0)
  })
})

describe('isGifImage', () => {
  it('matches an image whose proxy URL names a GIF blob', () => {
    const cids = new Set(['bafygif'])
    expect(
      isGifImage(
        {
          fullsize:
            'https://img.coves.test/img/content_full/plain/did:plc:a/bafygif',
        },
        cids,
      ),
    ).toBe(true)
    expect(
      isGifImage(
        {
          fullsize:
            'https://img.coves.test/img/content_full/plain/did:plc:a/bafyjpg',
        },
        cids,
      ),
    ).toBe(false)
    expect(isGifImage({ fullsize: 'https://example.com/a.gif' }, cids)).toBe(
      false,
    )
  })
})
