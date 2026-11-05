/**
 * `#image` placements through the comment write paths. A comment is created
 * from a source holding `![covered](image:N)` tokens, and an edit seeds the
 * editor with those tokens rebuilt from the stored facets, so saving without
 * changes sends back exactly what is stored. A placement the token cannot
 * express is dropped from the source and counted, and the rest is kept.
 *
 * Every stored fixture is written out by hand with literal byte offsets, and
 * each is what the compiler produces for the source named beside it.
 */
import { describe, expect, it, vi } from 'vitest'
import type {
  AtUri,
  CID,
  CommentRecord,
  ImagesEmbedRecord,
  StrongRef,
} from '$lib/api/coves/types'
import { parseMarkup } from '$lib/feature/richtext/compose'
import {
  buildCommentCreate,
  buildCommentUpdate,
  editorSourceFor,
} from './comment-submit'

const NS = 'social.coves.richtext.facet'
const image = (index: number) => ({ $type: `${NS}#image`, index })
const bold = { $type: `${NS}#bold` }

interface StoredFacet {
  index: { byteStart: number; byteEnd: number }
  features: Record<string, unknown>[]
}

function facet(
  byteStart: number,
  byteEnd: number,
  ...features: Record<string, unknown>[]
): StoredFacet {
  return { index: { byteStart, byteEnd }, features }
}

/** Facets that only carry the `#image` feature. */
function imageFacets(facets: unknown[] | undefined): unknown[] {
  return (facets ?? []).filter((candidate) =>
    (candidate as StoredFacet).features.some(
      (feature) => feature.$type === `${NS}#image`,
    ),
  )
}

/**
 * Facets in a fixed order. The lexicon orders facets by byteStart only, so two
 * facets over the same bytes (a placement beside its quote or bold) may come
 * back in either order.
 */
function inFixedOrder(facets: unknown[] | undefined): unknown[] {
  return [...(facets ?? [])].sort((first, second) => {
    const a = first as StoredFacet
    const b = second as StoredFacet
    return (
      a.index.byteStart - b.index.byteStart ||
      a.index.byteEnd - b.index.byteEnd ||
      JSON.stringify(a.features).localeCompare(JSON.stringify(b.features))
    )
  })
}

const POST_REF: StrongRef = {
  uri: 'at://did:plc:author/social.coves.community.post/one' as AtUri,
  cid: 'bafypost' as CID,
}
const COMMENT_URI =
  'at://did:plc:me/social.coves.community.comment/three' as AtUri

function fakeResolver() {
  return {
    resolveHandle: vi.fn(async (_params: { handle: string }) => ({
      did: 'did:plc:alice',
    })),
    getCommunity: vi.fn(async (_params: { community: string }) => ({
      did: 'did:plc:gaming',
    })),
  }
}

function embedImage(name: string, alt?: string) {
  return {
    image: {
      $type: 'blob' as const,
      ref: { $link: `bafy-${name}` },
      mimeType: 'image/png',
      size: 1024,
    },
    ...(alt ? { alt } : {}),
    aspectRatio: { width: 300, height: 200 },
  }
}

const ONE_IMAGE: ImagesEmbedRecord = {
  $type: 'social.coves.embed.images',
  images: [embedImage('a.png', 'Sleeping tabby on a rug')],
}

const TWO_IMAGES: ImagesEmbedRecord = {
  $type: 'social.coves.embed.images',
  images: [
    embedImage('a.png', 'Sleeping tabby on a rug'),
    embedImage('b.png', 'A kite over the beach'),
  ],
}

const IMAGES_WITH_QUOTED_POST: CommentRecord['embed'] = {
  $type: 'social.coves.embed.imagesWithAttachment',
  images: {
    $type: 'social.coves.embed.images',
    images: [
      embedImage('a.png', 'Sleeping tabby on a rug'),
      embedImage('b.png', 'A kite over the beach'),
    ],
  },
  attachment: {
    $type: 'social.coves.embed.post',
    post: {
      uri: 'at://did:plc:quoted/social.coves.community.post/four' as AtUri,
      cid: 'bafyquoted' as CID,
    },
  },
}

function record(overrides: Partial<CommentRecord> = {}): CommentRecord {
  return {
    $type: 'social.coves.community.comment',
    content: 'stored',
    reply: { root: POST_REF, parent: POST_REF },
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

describe('buildCommentCreate — placements', () => {
  it('compiles a placement token to its covered text and one #image facet', async () => {
    const input = await buildCommentCreate({
      source: 'Intro\n![first](image:1)\nOutro',
      postRef: POST_REF,
      resolver: fakeResolver(),
      embed: TWO_IMAGES,
    })

    expect(input.embed).toEqual(TWO_IMAGES)
    expect(input.content).toBe('Intro\nfirst\nOutro')
    expect(input.facets).toEqual([facet(6, 11, image(0))])
  })
})

describe('editing a comment with placements — round trip', () => {
  const ROWS: {
    name: string
    content: string
    facets: StoredFacet[]
    embed?: CommentRecord['embed']
  }[] = [
    {
      // Intro\n![first](image:1)\nOutro
      name: 'a top-level placement',
      content: 'Intro\nfirst\nOutro',
      facets: [facet(6, 11, image(0))],
    },
    {
      // before ![x](image:2) after
      name: 'a mid-paragraph placement',
      content: 'before x after',
      facets: [facet(7, 8, image(1))],
    },
    {
      // > quoted ![x](image:1) text
      name: 'a placement inside a quote',
      content: 'quoted x text',
      facets: [
        facet(0, 13, { $type: `${NS}#blockquote`, level: 1 }),
        facet(7, 8, image(0)),
      ],
    },
    {
      // ::: spoiler why\nsee ![x](image:1) here\n:::
      name: 'a placement inside a spoiler',
      content: 'see x here',
      facets: [
        facet(0, 10, { $type: `${NS}#spoiler`, reason: 'why' }),
        facet(4, 5, image(0)),
      ],
    },
    {
      // ::: spoiler\na\n![x](image:1)\nb\n:::
      name: 'an own-line placement inside a multi-line spoiler',
      content: 'a\nx\nb',
      facets: [facet(0, 5, { $type: `${NS}#spoiler` }), facet(2, 3, image(0))],
    },
    {
      // # before ![x](image:1) after
      name: 'a placement inside a heading',
      content: 'before x after',
      facets: [
        facet(0, 14, { $type: `${NS}#heading`, level: 1 }),
        facet(7, 8, image(0)),
      ],
    },
    {
      // a **![x](image:1)** b
      name: 'a placement coextensive with a bold range',
      content: 'a x b',
      facets: [facet(2, 3, bold), facet(2, 3, image(0))],
    },
    {
      // ![A cat](image:1) — the image's alt is "Sleeping tabby on a rug"
      name: 'covered text that differs from the alt',
      content: 'A cat',
      facets: [facet(0, 5, image(0))],
    },
    {
      // ![a\*b \[c\]](image:1)
      name: 'covered text holding markup characters',
      content: 'a*b [c]',
      facets: [facet(0, 7, image(0))],
    },
    {
      // ![a\] \\ b](image:1)
      name: 'covered text holding an unbalanced bracket and a backslash',
      content: 'a] \\ b',
      facets: [facet(0, 6, image(0))],
    },
    {
      // Look: ![second](image:2)
      name: 'a placement of image 2 in an images embed with a quoted post',
      content: 'Look: second',
      facets: [facet(6, 12, image(1))],
      embed: IMAGES_WITH_QUOTED_POST,
    },
  ]

  it.each(ROWS)(
    'saves $name back unchanged',
    async ({ content, facets, embed }) => {
      const stored = record({ content, facets, embed: embed ?? TWO_IMAGES })

      const { source, droppedPlacements } = editorSourceFor(stored, 2)
      const input = await buildCommentUpdate({
        source,
        uri: COMMENT_URI,
        record: stored,
        resolver: fakeResolver(),
      })

      expect(droppedPlacements).toBe(0)
      expect(input.content).toBe(content)
      expect(inFixedOrder(input.facets)).toEqual(inFixedOrder(facets))
      expect(input.embed).toEqual(stored.embed)
    },
  )

  it('keeps a placement from create through an unchanged edit', async () => {
    const created = await buildCommentCreate({
      source: '![first](image:1)',
      postRef: POST_REF,
      resolver: fakeResolver(),
      embed: ONE_IMAGE,
    })
    const stored = record({
      content: created.content,
      facets: created.facets,
      embed: created.embed,
    })

    const input = await buildCommentUpdate({
      source: editorSourceFor(stored, 1).source,
      uri: COMMENT_URI,
      record: stored,
      resolver: fakeResolver(),
    })

    expect(input.content).toBe('first')
    expect(imageFacets(input.facets)).toEqual([facet(0, 5, image(0))])
    expect(input.embed).toEqual(ONE_IMAGE)
  })

  it('keeps a literal token with no facet literal (guard)', async () => {
    const stored = record({ content: '![x](image:1)', embed: ONE_IMAGE })

    const { source, droppedPlacements } = editorSourceFor(stored, 1)
    const input = await buildCommentUpdate({
      source,
      uri: COMMENT_URI,
      record: stored,
      resolver: fakeResolver(),
    })

    expect(droppedPlacements).toBe(0)
    expect(input.content).toBe('![x](image:1)')
    expect(Object.keys(input)).not.toContain('facets')
  })
})

describe('editing a comment with placements — changed source', () => {
  // Hello\n![A cat](image:1)\nBye
  const stored = record({
    content: 'Hello\nA cat\nBye',
    facets: [facet(6, 11, image(0))],
    embed: ONE_IMAGE,
  })

  async function update(source: string) {
    return buildCommentUpdate({
      source,
      uri: COMMENT_URI,
      record: stored,
      resolver: fakeResolver(),
    })
  }

  it('moves the placement with its covered text when text is added before it', async () => {
    const { source } = editorSourceFor(stored, 1)
    expect(source).toContain('![A cat](image:1)')

    const input = await update(`New ${source}`)

    expect(input.content).toBe('New Hello\nA cat\nBye')
    expect(imageFacets(input.facets)).toEqual([facet(10, 15, image(0))])
  })

  it('drops the placement and its covered text when the token is deleted', async () => {
    const { source } = editorSourceFor(stored, 1)
    expect(source).toContain('![A cat](image:1)')

    const input = await update(source.replace('![A cat](image:1)', ''))

    expect(input.content).not.toContain('A cat')
    expect(imageFacets(input.facets)).toEqual([])
  })

  it('sends no placement once the token no longer parses', async () => {
    const { source } = editorSourceFor(stored, 1)
    expect(source).toContain('![A cat](image:1)')

    const input = await update(source.replace('](image:1)', ']image:1)'))

    expect(imageFacets(input.facets)).toEqual([])
  })
})

describe('editing a comment with a placement the token cannot express', () => {
  it('drops a placement half-overlapping a bold range and keeps the bold', () => {
    // Bold over "ab c", placement over "cd".
    const stored = record({
      content: 'ab cd',
      facets: [facet(0, 4, bold), facet(3, 5, image(0))],
      embed: ONE_IMAGE,
    })

    const { source, droppedPlacements } = editorSourceFor(stored, 1)

    expect(droppedPlacements).toBe(1)
    expect(source).not.toContain('](image:')
    expect(source).toContain('**')
  })

  it('counts every placement as dropped when the source falls back to escaped content', () => {
    // A code block that starts mid-line cannot be written as markup that
    // compiles back to the same content, so the editor is seeded with the
    // escaped raw content and the placement over "x", which the token could
    // express on its own, is lost with it.
    const stored = record({
      content: 'x ab c',
      facets: [
        facet(0, 1, image(0)),
        facet(2, 4, { $type: `${NS}#codeBlock` }),
      ],
      embed: ONE_IMAGE,
    })

    const { source, droppedPlacements } = editorSourceFor(stored, 1)

    expect(droppedPlacements).toBe(1)
    expect(source).not.toContain('](image:')
    expect(parseMarkup(source, { imageCount: 1 }).content).toBe(stored.content)
  })

  it('drops a placement over link text and keeps the link', () => {
    const stored = record({
      content: 'x',
      facets: [
        facet(0, 1, { $type: `${NS}#link`, uri: 'https://a.example' }),
        facet(0, 1, image(0)),
      ],
      embed: ONE_IMAGE,
    })

    const { source, droppedPlacements } = editorSourceFor(stored, 1)

    expect(droppedPlacements).toBe(1)
    expect(source).not.toContain('](image:')
    expect(parseMarkup(source, { imageCount: 1 })).toEqual({
      content: 'x',
      facets: [facet(0, 1, { $type: `${NS}#link`, uri: 'https://a.example' })],
      mentions: [],
    })
  })
})
