import { describe, expect, it } from 'vitest'
import type { EmbedImage, PostEmbed } from '$lib/api/coves/types'
import {
  fittedImageWidth,
  imageAspectRatio,
  imageLayout,
  removePlacedText,
} from './image-layout'
import { byteLength, byteRange, facetOver } from './test-helpers'

const NS = 'social.coves.richtext.facet'
const image = (index: number) => ({ $type: `${NS}#image`, index })
const bold = { $type: `${NS}#bold` }
const code = { $type: `${NS}#code` }
const codeBlock = { $type: `${NS}#codeBlock` }

const KITE: EmbedImage = {
  thumb: 'https://img.coves.test/img/content_preview/plain/did:plc:a/kite',
  fullsize: 'https://img.coves.test/img/content_full/plain/did:plc:a/kite',
  alt: 'Kite over the dunes',
}
const HERON: EmbedImage = {
  thumb: 'https://img.coves.test/img/content_preview/plain/did:plc:a/heron',
  fullsize: 'https://img.coves.test/img/content_full/plain/did:plc:a/heron',
  alt: 'Heron in the reeds',
}
const WREN: EmbedImage = {
  thumb: 'https://img.coves.test/img/content_preview/plain/did:plc:a/wren',
  fullsize: 'https://img.coves.test/img/content_full/plain/did:plc:a/wren',
  alt: 'Wren on a post',
}

const threeImages: PostEmbed = {
  $type: 'social.coves.embed.images#view',
  images: [KITE, HERON, WREN],
}

/** Gallery and placed images together are exactly the embed's images. */
function expectNoImageLost(
  layout: ReturnType<typeof imageLayout>,
  images: EmbedImage[],
): void {
  const shown = [...layout.gallery, ...layout.placed.values()]
  expect(shown).toHaveLength(images.length)
  expect(shown).toEqual(expect.arrayContaining(images))
}

describe('imageLayout', () => {
  it('places valid placements of indices 0 and 2 and keeps index 1 in the gallery', () => {
    const content = '[a] one [c] two'
    const facets = [
      facetOver(content, 'one', bold),
      facetOver(content, '[a]', image(0)),
      facetOver(content, '[c]', image(2)),
    ]

    const layout = imageLayout(threeImages, content, facets)

    expect(layout.placed).toEqual(
      new Map([
        [1, KITE],
        [2, WREN],
      ]),
    )
    expect(layout.gallery).toEqual([HERON])
    expectNoImageLost(layout, [KITE, HERON, WREN])
  })

  it('reads the main image list of an imagesWithAttachment view', () => {
    const embed: PostEmbed = {
      $type: 'social.coves.embed.imagesWithAttachment#view',
      images: {
        $type: 'social.coves.embed.images#view',
        images: [KITE, HERON, WREN],
      },
      attachment: {
        $type: 'social.coves.embed.external#viewExternal',
        uri: 'https://example.test/article',
        title: 'An article',
      },
    }
    const content = 'Look [b] here'
    const facets = [facetOver(content, '[b]', image(1))]

    const layout = imageLayout(embed, content, facets)

    expect(layout.placed).toEqual(new Map([[0, HERON]]))
    expect(layout.gallery).toEqual([KITE, WREN])
    expectNoImageLost(layout, [KITE, HERON, WREN])
  })

  it.each([
    { label: 'no embed', embed: undefined },
    {
      label: 'an external embed',
      embed: {
        $type: 'social.coves.embed.external#view',
        external: { uri: 'https://example.test/page', title: 'A page' },
      } satisfies PostEmbed,
    },
  ])('places nothing and has an empty gallery for $label', ({ embed }) => {
    const content = '[a] text'
    const facets = [facetOver(content, '[a]', image(0))]

    const layout = imageLayout(embed, content, facets)

    expect(layout.gallery).toEqual([])
    expect(layout.placed).toEqual(new Map())
  })

  it('accepts a placement whose range follows a multi-byte character', () => {
    const embed: PostEmbed = {
      $type: 'social.coves.embed.images#view',
      images: [KITE],
    }
    const content = '🙂[image]'
    const facets = [
      { index: { byteStart: 4, byteEnd: 11 }, features: [image(0)] },
    ]

    const layout = imageLayout(embed, content, facets)

    expect(layout.placed).toEqual(new Map([[0, KITE]]))
    expect(layout.gallery).toEqual([])
    expectNoImageLost(layout, [KITE])
  })

  // Every row starts with a valid control placement of index 1 over "[ok]"
  // (facet 0), so a guard rejects only its own facet, never the whole set.
  // The rejected facet's image stays in the gallery.
  const control = (content: string) => facetOver(content, '[ok]', image(1))
  const span = (
    byteStart: number,
    byteEnd: number,
    ...features: unknown[]
  ) => ({
    index: { byteStart, byteEnd },
    features,
  })

  it.each([
    {
      label: 'an index past the end of the images',
      content: '[ok] then [bad]',
      rejected: (content: string) => [facetOver(content, '[bad]', image(3))],
    },
    {
      label: 'a second placement of the same index',
      content: '[ok] then [bad]',
      rejected: (content: string) => [facetOver(content, '[bad]', image(1))],
    },
    {
      label: 'a second feature in the same facet',
      content: '[ok] then [bad]',
      rejected: (content: string) => [
        facetOver(content, '[bad]', image(0), bold),
      ],
    },
    {
      label: 'an empty range',
      content: '[ok] then [bad]',
      rejected: (content: string) => {
        const { byteStart } = byteRange(content, '[bad]')
        return [span(byteStart, byteStart, image(0))]
      },
    },
    {
      label: 'a range ending past the content',
      content: '[ok] then [bad]',
      rejected: (content: string) => {
        const { byteStart } = byteRange(content, '[bad]')
        return [span(byteStart, byteLength(content) + 1, image(0))]
      },
    },
    {
      label: 'a range starting inside a multi-byte character',
      content: '[ok] then 🙂[bad]',
      rejected: (content: string) => {
        const { byteStart } = byteRange(content, '🙂')
        const { byteEnd } = byteRange(content, '[bad]')
        return [span(byteStart + 2, byteEnd, image(0))]
      },
    },
    {
      label: 'a range ending inside a multi-byte character',
      content: '[ok] then [bad]🙂',
      rejected: (content: string) => {
        const { byteStart, byteEnd } = byteRange(content, '[bad]')
        return [span(byteStart, byteEnd + 2, image(0))]
      },
    },
    {
      label: 'a range inside a #code range',
      content: '[ok] then see [bad] here',
      rejected: (content: string) => [
        facetOver(content, 'see [bad] here', code),
        facetOver(content, '[bad]', image(0)),
      ],
    },
    {
      label: 'a range inside a #codeBlock range',
      content: '[ok] then\nsee [bad] here',
      rejected: (content: string) => [
        facetOver(content, 'see [bad] here', codeBlock),
        facetOver(content, '[bad]', image(0)),
      ],
    },
  ])(
    'rejects $label and keeps its image in the gallery',
    ({ content, rejected }) => {
      const facets = [control(content), ...rejected(content)]

      const layout = imageLayout(threeImages, content, facets)

      expect(layout.placed).toEqual(new Map([[0, HERON]]))
      expect(layout.gallery).toEqual([KITE, WREN])
      expectNoImageLost(layout, [KITE, HERON, WREN])
    },
  )
})

describe('imageAspectRatio', () => {
  const fullsize = KITE.fullsize

  it('accepts two finite positive numbers', () => {
    expect(
      imageAspectRatio({ fullsize, aspectRatio: { width: 4, height: 3 } }),
    ).toEqual({ width: 4, height: 3 })
  })

  // aspectRatio is untrusted record data written into inline styles.
  it.each([
    ['a missing ratio', undefined],
    ['a zero width', { width: 0, height: 1 }],
    ['a negative height', { width: 4, height: -3 }],
    ['a NaN height', { width: 4, height: Number.NaN }],
    ['an infinite width', { width: Number.POSITIVE_INFINITY, height: 3 }],
    ['a string width', { width: '1; position:fixed; inset:0', height: 1 }],
    ['a numeric string height', { width: 4, height: '3' }],
    ['a non-object ratio', '16 / 9'],
  ])('rejects %s', (_name, aspectRatio) => {
    expect(
      imageAspectRatio({ fullsize, aspectRatio } as unknown as EmbedImage),
    ).toBeUndefined()
  })
})

describe('fittedImageWidth', () => {
  const fullsize = 'https://img.coves.test/full'

  it('limits a square image to the viewport height budget', () => {
    expect(
      fittedImageWidth({
        fullsize,
        aspectRatio: { width: 1400, height: 1400 },
      }),
    ).toBe('min(100%, calc(60vh * 1400 / 1400))')
  })

  it.each([
    ['no aspect ratio', undefined],
    ['a zero height', { width: 800, height: 0 }],
  ])('falls back to 4:3 for %s', (_, aspectRatio) => {
    expect(fittedImageWidth({ fullsize, aspectRatio })).toBe(
      'min(100%, calc(60vh * 4 / 3))',
    )
  })
})

describe('removePlacedText', () => {
  it('drops a leading placement and the blank line after it', () => {
    const content = '[image]\n\nHello'
    const facets = [facetOver(content, '[image]', image(0))]

    expect(removePlacedText(threeImages, content, facets)).toBe('Hello')
  })

  it('drops a placement between paragraphs and collapses the blank line', () => {
    const content = 'Intro\n\n[image]\n\nOutro'
    const facets = [facetOver(content, '[image]', image(0))]

    expect(removePlacedText(threeImages, content, facets)).toBe(
      'Intro\n\nOutro',
    )
  })

  it('keeps the text of a rejected placement', () => {
    // The accepted control placement over "[ok]" is removed; the
    // out-of-bounds one over "[image]" stays as plain text.
    const content = '[ok]\n\n[image]\n\nHello'
    const facets = [
      facetOver(content, '[ok]', image(0)),
      facetOver(content, '[image]', image(3)),
    ]

    expect(removePlacedText(threeImages, content, facets)).toBe(
      '[image]\n\nHello',
    )
  })
  it('keeps text covered by an outer placement out when another sits inside it', () => {
    const content = '[outer [inner] image]\n\nHello'
    const facets = [
      facetOver(content, '[outer [inner] image]', image(0)),
      facetOver(content, '[inner]', image(1)),
    ]

    expect(removePlacedText(threeImages, content, facets)).toBe('Hello')
  })
})
