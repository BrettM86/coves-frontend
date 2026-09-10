/**
 * The comment write paths. The load-bearing case is the edit: the editor is
 * seeded from the stored facets, and saving recompiles from what the author
 * left in the box. Reusing the record's old facets after an edit would
 * annotate byte ranges that no longer describe the text.
 */
import { describe, expect, it, vi } from 'vitest'
import type { AtUri, CID, CommentRecord, StrongRef } from '$lib/api/coves/types'
import { parseMarkup } from '$lib/feature/richtext/compose'
import { byteLength, byteRange } from '$lib/feature/richtext/test-helpers'
import {
  buildCommentCreate,
  buildCommentUpdate,
  editorSourceFor,
} from './comment-submit'

const NS = 'social.coves.richtext.facet'
const bold = { $type: `${NS}#bold` }
const code = { $type: `${NS}#code` }
const codeBlock = { $type: `${NS}#codeBlock` }

const HANDLE = 'alice.coves.social'
const USER = `@${HANDLE}`
const ALICE = 'did:plc:alice'
const mentionFeature = { $type: `${NS}#mention`, did: ALICE }

const POST_REF: StrongRef = {
  uri: 'at://did:plc:author/social.coves.community.post/one' as AtUri,
  cid: 'bafypost' as CID,
}
const PARENT_REF: StrongRef = {
  uri: 'at://did:plc:other/social.coves.community.comment/two' as AtUri,
  cid: 'bafyparent' as CID,
}
const COMMENT_URI =
  'at://did:plc:me/social.coves.community.comment/three' as AtUri

function fakeResolver() {
  return {
    resolveHandle: vi.fn(async (_params: { handle: string }) => ({
      did: ALICE,
    })),
    getCommunity: vi.fn(async (_params: { community: string }) => ({
      did: 'did:plc:gaming',
    })),
  }
}

function record(overrides: Partial<CommentRecord> = {}): CommentRecord {
  return {
    $type: 'social.coves.community.comment',
    content: 'say loud now',
    reply: { root: POST_REF, parent: POST_REF },
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

describe('editorSourceFor', () => {
  it('seeds the editor with markup that recompiles to the stored record', () => {
    const stored = record({
      content: 'say loud now',
      facets: [{ index: byteRange('say loud now', 'loud'), features: [bold] }],
    })

    const source = editorSourceFor(stored)

    // The markup carries markers the plain content does not.
    expect(source).not.toBe(stored.content)
    const reparsed = parseMarkup(source)
    expect(reparsed.content).toBe(stored.content)
    expect(reparsed.facets).toEqual(stored.facets)
  })

  it('returns the plain content when the record has no facets', () => {
    expect(editorSourceFor({ content: 'just words' })).toBe('just words')
  })
})

describe('buildCommentCreate', () => {
  it('replies to the given parent under the post root', async () => {
    const input = await buildCommentCreate({
      source: 'a reply',
      postRef: POST_REF,
      parentRef: PARENT_REF,
      resolver: fakeResolver(),
    })

    expect(input.reply).toEqual({ root: POST_REF, parent: PARENT_REF })
    expect(input.content).toBe('a reply')
  })

  it('uses the post as its own parent for a top-level comment', async () => {
    const input = await buildCommentCreate({
      source: 'a reply',
      postRef: POST_REF,
      resolver: fakeResolver(),
    })

    expect(input.reply).toEqual({ root: POST_REF, parent: POST_REF })
  })

  it('sends canonical content with the compiled facets', async () => {
    const resolver = fakeResolver()

    const input = await buildCommentCreate({
      source: `**hi** ${USER}`,
      postRef: POST_REF,
      resolver,
    })

    expect(input.content).toBe(`hi ${USER}`)
    expect(input.facets).toEqual([
      { index: byteRange(input.content, 'hi'), features: [bold] },
      {
        index: byteRange(input.content, USER),
        features: [{ $type: `${NS}#mention`, did: ALICE }],
      },
    ])
  })

  it('omits the facets key when the comment has nothing to annotate', async () => {
    const input = await buildCommentCreate({
      source: 'just words',
      postRef: POST_REF,
      resolver: fakeResolver(),
    })

    expect(Object.keys(input)).not.toContain('facets')
  })
})

describe('buildCommentUpdate', () => {
  it('recompiles from the edited source instead of reusing stale facets', async () => {
    // The stored facet marks "loud" at bytes 4..8. After the edit those bytes
    // are "quie", so carrying it over would bold the wrong text.
    const stored = record({
      content: 'say loud now',
      facets: [{ index: byteRange('say loud now', 'loud'), features: [bold] }],
    })

    const input = await buildCommentUpdate({
      source: 'say **quiet** now',
      uri: COMMENT_URI,
      record: stored,
      resolver: fakeResolver(),
    })

    expect(input.content).toBe('say quiet now')
    expect(input.facets).toEqual([
      { index: byteRange('say quiet now', 'quiet'), features: [bold] },
    ])
  })

  it('addresses the update at the comment uri', async () => {
    const input = await buildCommentUpdate({
      source: 'edited',
      uri: COMMENT_URI,
      record: record(),
      resolver: fakeResolver(),
    })

    expect(input.uri).toBe(COMMENT_URI)
  })

  it('passes embed, langs and labels through from the record', async () => {
    // An update is a full record replacement, so anything not re-sent is
    // cleared on the server.
    const embed = {
      $type: 'social.coves.embed.external',
      external: { uri: 'https://example.com/a' },
    }
    const labels = {
      $type: 'com.atproto.label.defs#selfLabels',
      values: [{ val: 'nsfw' }],
    }
    const stored = record({ embed, langs: ['en'], labels })

    const input = await buildCommentUpdate({
      source: 'edited',
      uri: COMMENT_URI,
      record: stored,
      resolver: fakeResolver(),
    })

    expect(input.embed).toEqual(embed)
    expect(input.langs).toEqual(['en'])
    expect(input.labels).toEqual(labels)
  })

  it('omits the facets key when the edited source has nothing to annotate', async () => {
    const stored = record({
      content: 'say loud now',
      facets: [{ index: byteRange('say loud now', 'loud'), features: [bold] }],
    })

    const input = await buildCommentUpdate({
      source: 'plain now',
      uri: COMMENT_URI,
      record: stored,
      resolver: fakeResolver(),
    })

    expect(input.content).toBe('plain now')
    expect(Object.keys(input)).not.toContain('facets')
  })
})

describe('comment content trimming', () => {
  it('trims the source before measuring facets on create', async () => {
    // The backend trims content and then validates facets against the trimmed
    // text, so offsets measured before the trim point past the end of it.
    const input = await buildCommentCreate({
      source: '**hi**\n',
      postRef: POST_REF,
      resolver: fakeResolver(),
    })

    expect(input.content).toBe('hi')
    expect(input.facets).toEqual([
      { index: byteRange('hi', 'hi'), features: [bold] },
    ])
  })

  it('trims surrounding whitespace from a plain create', async () => {
    const input = await buildCommentCreate({
      source: '\n  text  \n',
      postRef: POST_REF,
      resolver: fakeResolver(),
    })

    expect(input.content).toBe('text')
    expect(Object.keys(input)).not.toContain('facets')
  })

  it('trims the source before measuring facets on update', async () => {
    const input = await buildCommentUpdate({
      source: '**hi**\n',
      uri: COMMENT_URI,
      record: record(),
      resolver: fakeResolver(),
    })

    expect(input.content).toBe('hi')
    expect(input.facets).toEqual([
      { index: byteRange('hi', 'hi'), features: [bold] },
    ])
  })
})

describe('editorSourceFor — content that looks like markup', () => {
  it.each([{ content: 'use *args* and _kwargs_' }, { content: 'a *b* c' }])(
    'escapes $content so editing does not rewrite it',
    ({ content }) => {
      // The record has no facets, so every marker in it is literal text. Seeding
      // the editor with it unescaped would compile those markers into formatting
      // on the next save and delete the characters.
      const reparsed = parseMarkup(editorSourceFor({ content }))

      expect(reparsed.content).toBe(content)
      expect(reparsed.facets).toEqual([])
    },
  )

  it('still recompiles to identical content when a facet cannot round-trip', () => {
    // A mention facet over text that is not a handle cannot be expressed in
    // markup. Falling back to the escaped raw content is fine; changing the
    // author's characters is not.
    const stored = record({
      content: 'Alice *smith*',
      facets: [
        {
          index: byteRange('Alice *smith*', 'Alice'),
          features: [{ $type: `${NS}#mention`, did: ALICE }],
        },
      ],
    })

    const reparsed = parseMarkup(editorSourceFor(stored))

    expect(reparsed.content).toBe(stored.content)
  })
})

describe('canonical content trimming', () => {
  /*
   * The trim has to happen to the COMPILED content, not the source. Markup
   * strips characters, so whitespace can only be found once the content is
   * canonical — and every facet measured before the trim then points at the
   * wrong bytes. Facets shift by what was removed from the front and clip to
   * what is left at the back.
   */
  const CASES = [
    {
      name: 'padding inside a code span',
      source: '` x `',
      content: 'x',
      facets: [{ index: { byteStart: 0, byteEnd: 1 }, features: [code] }],
    },
    {
      name: 'a trailing blank line inside a fence',
      source: '```\ncode\n\n```',
      content: 'code',
      facets: [{ index: { byteStart: 0, byteEnd: 4 }, features: [codeBlock] }],
    },
    {
      name: 'trailing spaces after a bold run',
      source: '**a**  ',
      content: 'a',
      facets: [{ index: { byteStart: 0, byteEnd: 1 }, features: [bold] }],
    },
    {
      name: 'leading padding inside a leading code span',
      source: '`  y` z',
      content: 'y z',
      facets: [{ index: { byteStart: 0, byteEnd: 1 }, features: [code] }],
    },
    {
      name: 'a mention pushed to the start by the trim',
      source: ` ${USER} hi`,
      content: `${USER} hi`,
      facets: [
        {
          index: { byteStart: 0, byteEnd: byteLength(USER) },
          features: [mentionFeature],
        },
      ],
    },
  ]

  it.each(CASES)(
    'trims $name on create',
    async ({ source, content, facets }) => {
      const input = await buildCommentCreate({
        source,
        postRef: POST_REF,
        resolver: fakeResolver(),
      })

      expect(input.content).toBe(content)
      expect(input.facets).toEqual(facets)
    },
  )

  it.each(CASES)(
    'trims $name on update',
    async ({ source, content, facets }) => {
      const input = await buildCommentUpdate({
        source,
        uri: COMMENT_URI,
        record: record(),
        resolver: fakeResolver(),
      })

      expect(input.content).toBe(content)
      expect(input.facets).toEqual(facets)
    },
  )

  it('leaves no facet behind when the trim empties the content', async () => {
    // A code span holding only a space compiles to a one-byte content that the
    // trim removes entirely. The facet over it would be zero-length, which is
    // never valid.
    const input = await buildCommentCreate({
      source: '` `',
      postRef: POST_REF,
      resolver: fakeResolver(),
    })

    expect(input.content).toBe('')
    expect(Object.keys(input)).not.toContain('facets')
  })
})
