import type {
  BlueskyProfileImportField,
  GetBlueskyProfileImportOutput,
} from '$lib/api/coves/types'

export type SettingsOutcome =
  | { kind: 'message'; reason: 'noBlueskyProfile' | 'nothingToImport' }
  | { kind: 'dialog'; fields: BlueskyProfileImportField[] }
  | { kind: 'error'; error: unknown }

export async function settingsOutcome(
  get: () => Promise<GetBlueskyProfileImportOutput>,
): Promise<SettingsOutcome> {
  let result: GetBlueskyProfileImportOutput
  try {
    result = await get()
  } catch (error) {
    return { kind: 'error', error }
  }
  if (result.status === 'noBlueskyProfile') {
    return { kind: 'message', reason: 'noBlueskyProfile' }
  }
  if (result.status === 'nothingToImport' || result.fields.length === 0) {
    return { kind: 'message', reason: 'nothingToImport' }
  }
  return { kind: 'dialog', fields: result.fields }
}
