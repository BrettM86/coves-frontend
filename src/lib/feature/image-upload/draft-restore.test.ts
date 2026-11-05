/**
 * The composer draft kept across a sign-in redirect: one entry in
 * sessionStorage, restored only by the composer it was saved from, and
 * harmless when the browser refuses storage access.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  restoreCommentDraft,
  restorePostDraft,
  saveComposerDraft,
  storedCommentDraftParent,
} from './draft-restore'

/** An in-memory Storage, standing in for the browser's in the node env. */
function memoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => {
      entries.delete(key)
    },
    setItem: (key: string, value: string) => {
      entries.set(key, String(value))
    },
  }
}

const PARENT_A = 'at://did:plc:alice/social.coves.community.comment/a'
const PARENT_B = 'at://did:plc:bob/social.coves.community.comment/b'
const POST_PATH = '/c/community.test/post/abc'

beforeEach(() => {
  vi.stubGlobal('sessionStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('draft restore', () => {
  it('restores a saved post draft on the same path once, then has nothing left', () => {
    saveComposerDraft('/create/post', {
      kind: 'post',
      title: 'Kites over the bay',
      url: 'https://example.com/kites',
      body: 'Seven red kites today.',
    })

    expect(restorePostDraft('/create/post')).toEqual({
      title: 'Kites over the bay',
      url: 'https://example.com/kites',
      body: 'Seven red kites today.',
    })
    expect(restorePostDraft('/create/post')).toBeUndefined()
  })

  it('keeps a reply draft for parent A from every other composer and path, and restores it for A afterwards', () => {
    saveComposerDraft(POST_PATH, {
      kind: 'comment',
      parentUri: PARENT_A,
      body: 'Agreed, the light was perfect.',
    })

    expect(restoreCommentDraft(POST_PATH, PARENT_B)).toBeUndefined()
    expect(restorePostDraft(POST_PATH)).toBeUndefined()
    expect(
      restoreCommentDraft('/c/community.test/post/other', PARENT_A),
    ).toBeUndefined()

    expect(restoreCommentDraft(POST_PATH, PARENT_A)).toBe(
      'Agreed, the light was perfect.',
    )
  })

  it('names the stored reply draft’s parent for its path without consuming it', () => {
    saveComposerDraft(POST_PATH, {
      kind: 'comment',
      parentUri: PARENT_A,
      body: 'Agreed, the light was perfect.',
    })

    expect(storedCommentDraftParent(POST_PATH)).toBe(PARENT_A)
    expect(storedCommentDraftParent(POST_PATH)).toBe(PARENT_A)
    expect(restoreCommentDraft(POST_PATH, PARENT_A)).toBe(
      'Agreed, the light was perfect.',
    )
  })

  it.each([
    [
      'its methods throw',
      () => {
        const refuse = () => {
          throw new DOMException('Access denied', 'SecurityError')
        }
        vi.stubGlobal('sessionStorage', {
          length: 0,
          clear: refuse,
          getItem: refuse,
          key: refuse,
          removeItem: refuse,
          setItem: refuse,
        })
      },
    ],
    [
      'reading the property throws',
      () => {
        Object.defineProperty(globalThis, 'sessionStorage', {
          configurable: true,
          get() {
            throw new DOMException('Access denied', 'SecurityError')
          },
        })
      },
    ],
  ])(
    'neither throws nor restores anything when sessionStorage %s',
    (_case, refuseStorage) => {
      refuseStorage()

      expect(() => {
        saveComposerDraft('/create/post', {
          kind: 'post',
          title: 'Kites',
          url: '',
          body: 'Body',
        })
        saveComposerDraft(POST_PATH, {
          kind: 'comment',
          parentUri: PARENT_A,
          body: 'Reply',
        })
      }).not.toThrow()
      expect(restorePostDraft('/create/post')).toBeUndefined()
      expect(restoreCommentDraft(POST_PATH, PARENT_A)).toBeUndefined()
      expect(storedCommentDraftParent(POST_PATH)).toBeUndefined()
    },
  )

  const KEY = 'coves.composerDraft'

  it.each([
    [
      'a post entry missing its title',
      { kind: 'post', path: '/create/post', url: '', body: 'Body' },
    ],
    [
      'a post entry with a numeric body',
      { kind: 'post', path: '/create/post', title: 'T', url: '', body: 42 },
    ],
    [
      'an entry of an unknown kind',
      { kind: 'poll', path: '/create/post', title: 'T', url: '', body: 'B' },
    ],
    [
      'an entry with a non-string path',
      { kind: 'post', path: 7, title: 'T', url: '', body: 'B' },
    ],
  ])('restores no post draft from %s and clears it', (_case, entry) => {
    sessionStorage.setItem(KEY, JSON.stringify(entry))

    expect(restorePostDraft('/create/post')).toBeUndefined()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it.each([
    [
      'a comment entry missing its parent URI',
      { kind: 'comment', path: POST_PATH, body: 'Reply' },
    ],
    [
      'a comment entry with a null body',
      { kind: 'comment', path: POST_PATH, parentUri: PARENT_A, body: null },
    ],
  ])('restores no comment draft from %s and clears it', (_case, entry) => {
    sessionStorage.setItem(KEY, JSON.stringify(entry))

    expect(restoreCommentDraft(POST_PATH, PARENT_A)).toBeUndefined()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('names no parent for a malformed comment entry and clears it', () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ kind: 'comment', path: POST_PATH, parentUri: PARENT_A }),
    )

    expect(storedCommentDraftParent(POST_PATH)).toBeUndefined()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it.each([
    ['not JSON', '{not json'],
    ['JSON null', 'null'],
    ['a JSON string', '"draft"'],
  ])(
    'restores nothing from an entry that is %s and clears it',
    (_case, raw) => {
      sessionStorage.setItem(KEY, raw)

      expect(restorePostDraft('/create/post')).toBeUndefined()
      expect(sessionStorage.getItem(KEY)).toBeNull()
    },
  )
})
