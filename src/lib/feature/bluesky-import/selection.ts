import type { BlueskyProfileImportField } from '$lib/api/coves/types'

/** A field row in the import dialog with its checkbox state. */
export type ImportRow = BlueskyProfileImportField & { checked: boolean }

/** 'offer' is the automatic post-sign-in offer; 'settings' is the button on /profile/settings. */
export type ImportMode = 'offer' | 'settings'

export function initialSelection(
  fields: readonly BlueskyProfileImportField[],
  mode: ImportMode,
): ImportRow[] {
  return fields
    .filter((field) => mode === 'settings' || field.covesIsEmpty)
    .map((field) => ({ ...field, checked: field.covesIsEmpty }))
}
