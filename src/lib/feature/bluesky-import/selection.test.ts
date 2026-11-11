/**
 * Which fields the import dialog lists and which start checked: the
 * automatic offer shows only fields empty on Coves, all checked; the settings
 * button shows every field, checked only where Coves is empty.
 */
import { describe, expect, it } from 'vitest'
import type { BlueskyProfileImportField } from '$lib/api/coves/types'
import { initialSelection } from './selection'

const AVATAR_URL =
  'http://localhost:3001/xrpc/com.atproto.sync.getBlob?did=did:plc:alice&cid=bafkreiavatar'

const fields: BlueskyProfileImportField[] = [
  { field: 'displayName', bluesky: 'Alice', covesIsEmpty: false },
  { field: 'description', bluesky: 'Kites and tides', covesIsEmpty: true },
  { field: 'avatar', blueskyImageUrl: AVATAR_URL, covesIsEmpty: true },
  {
    field: 'banner',
    blueskyImageUrl: 'http://localhost:3001/banner',
    covesIsEmpty: false,
  },
]

describe('initialSelection', () => {
  it('offer mode lists only fields empty on Coves, all checked, in server order', () => {
    expect(initialSelection(fields, 'offer')).toEqual([
      {
        field: 'description',
        bluesky: 'Kites and tides',
        covesIsEmpty: true,
        checked: true,
      },
      {
        field: 'avatar',
        blueskyImageUrl: AVATAR_URL,
        covesIsEmpty: true,
        checked: true,
      },
    ])
  })

  it('settings mode lists every field in server order, checked iff empty on Coves', () => {
    expect(initialSelection(fields, 'settings')).toEqual([
      {
        field: 'displayName',
        bluesky: 'Alice',
        covesIsEmpty: false,
        checked: false,
      },
      {
        field: 'description',
        bluesky: 'Kites and tides',
        covesIsEmpty: true,
        checked: true,
      },
      {
        field: 'avatar',
        blueskyImageUrl: AVATAR_URL,
        covesIsEmpty: true,
        checked: true,
      },
      {
        field: 'banner',
        blueskyImageUrl: 'http://localhost:3001/banner',
        covesIsEmpty: false,
        checked: false,
      },
    ])
  })

  it('offer mode lists nothing when every field is already set on Coves', () => {
    const allSet = fields.map((f) => ({ ...f, covesIsEmpty: false }))
    expect(initialSelection(allSet, 'offer')).toEqual([])
    expect(initialSelection(allSet, 'settings')).toHaveLength(4)
  })
})
