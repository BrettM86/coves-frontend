/**
 * The composer text kept across a sign-in redirect: one sessionStorage
 * entry, restored only by the composer it was saved from. Storage access can
 * throw (blocked site data, private windows), so every access is guarded and
 * a refusal means there is simply no draft.
 */
export type ComposerDraft =
  | { kind: 'post'; title: string; url: string; body: string }
  | { kind: 'comment'; parentUri: string; body: string }

type StoredDraft = ComposerDraft & { path: string }

const KEY = 'coves.composerDraft'

/** The stored entry, or undefined when it lacks a string field its kind needs. */
function parse(raw: string): StoredDraft | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  if (!('path' in value) || typeof value.path !== 'string') return undefined
  if (!('body' in value) || typeof value.body !== 'string') return undefined
  if (!('kind' in value)) return undefined
  const { path, body } = value
  if (value.kind === 'post') {
    if (!('title' in value) || typeof value.title !== 'string') return undefined
    if (!('url' in value) || typeof value.url !== 'string') return undefined
    return { kind: 'post', path, title: value.title, url: value.url, body }
  }
  if (value.kind === 'comment') {
    if (!('parentUri' in value) || typeof value.parentUri !== 'string')
      return undefined
    return { kind: 'comment', path, parentUri: value.parentUri, body }
  }
  return undefined
}

/** The draft saved for `path`; a malformed entry is cleared, never restored. */
function read(path: string): StoredDraft | undefined {
  let raw: string | null
  try {
    raw = sessionStorage.getItem(KEY)
  } catch {
    return undefined
  }
  if (!raw) return undefined
  const draft = parse(raw)
  if (!draft) {
    clear()
    return undefined
  }
  return draft.path === path ? draft : undefined
}

function clear(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Nothing was readable either, so nothing is restored twice.
  }
}

export function saveComposerDraft(path: string, draft: ComposerDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...draft, path }))
  } catch {
    // Without storage the text is lost on sign-in; the redirect still runs.
  }
}

/** Returns and consumes the post draft saved for `path`. */
export function restorePostDraft(
  path: string,
): { title: string; url: string; body: string } | undefined {
  const draft = read(path)
  if (draft?.kind !== 'post') return undefined
  clear()
  return { title: draft.title, url: draft.url, body: draft.body }
}

/** Returns and consumes the comment draft saved for `path` under `parentUri`. */
export function restoreCommentDraft(
  path: string,
  parentUri: string,
): string | undefined {
  const draft = read(path)
  if (draft?.kind !== 'comment' || draft.parentUri !== parentUri)
    return undefined
  clear()
  return draft.body
}

/** The parent URI of the comment draft saved for `path`, left stored. */
export function storedCommentDraftParent(path: string): string | undefined {
  const draft = read(path)
  return draft?.kind === 'comment' ? draft.parentUri : undefined
}
