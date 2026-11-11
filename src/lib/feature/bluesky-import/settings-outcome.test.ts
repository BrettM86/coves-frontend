/**
 * What the settings "Import from Bluesky" button does for each status the
 * server reports: a short message when there is nothing on Bluesky to bring
 * over, otherwise the dialog with every field. Dismissal is ignored here.
 */
import { describe, expect, it } from 'vitest'
import { XrpcError } from '$lib/api/coves/xrpc'
import type { BlueskyProfileImportField } from '$lib/api/coves/types'
import { settingsOutcome } from './settings-outcome'

const fields: BlueskyProfileImportField[] = [
  { field: 'displayName', bluesky: 'Alice', covesIsEmpty: false },
  {
    field: 'avatar',
    blueskyImageUrl: 'http://localhost:3001/avatar',
    covesIsEmpty: true,
  },
]

describe('settingsOutcome', () => {
  it.each(['noBlueskyProfile', 'nothingToImport'])(
    '%s → a message, no dialog',
    async (status) => {
      const outcome = await settingsOutcome(async () => ({
        status,
        fields: [],
      }))
      expect(outcome).toEqual({ kind: 'message', reason: status })
    },
  )

  it.each(['dismissed', 'complete', 'offer'])(
    '%s → the dialog with every field',
    async (status) => {
      const outcome = await settingsOutcome(async () => ({ status, fields }))
      expect(outcome).toEqual({ kind: 'dialog', fields })
    },
  )

  it.each(['offer', 'dismissed', 'complete'])(
    '%s with no fields → the nothingToImport message, no dialog',
    async (status) => {
      const outcome = await settingsOutcome(async () => ({
        status,
        fields: [],
      }))
      expect(outcome).toEqual({ kind: 'message', reason: 'nothingToImport' })
    },
  )

  it('a failed get → an error outcome carrying the failure', async () => {
    const failure = new XrpcError(500, 'PDSError', 'unreachable')
    const outcome = await settingsOutcome(async () => {
      throw failure
    })
    expect(outcome).toEqual({ kind: 'error', error: failure })
  })
})
