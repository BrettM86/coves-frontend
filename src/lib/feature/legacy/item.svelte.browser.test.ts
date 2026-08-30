/**
 * The browser half of the resumables contract.
 *
 * Without this, `item.svelte.test.ts` could be satisfied by making `add` a
 * no-op everywhere — which would silently delete the "jump back in" feature
 * rather than make it request-safe.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('$app/environment', () => ({
  browser: true,
  dev: false,
  building: false,
  version: 'test',
}))

vi.mock('$lib/ui/kit', () => ({ toast: vi.fn() }))

import { resumables, type ResumableItem } from './item.svelte'

const item = (name: string): ResumableItem => ({
  url: `/c/${name}`,
  name,
  type: 'community',
})

describe('resumables in the browser', () => {
  it('records what was visited, most recent first', () => {
    resumables.add(item('news.coves.social'))
    resumables.add(item('linux.coves.social'))

    expect(resumables.items.map((i) => i.name)).toEqual([
      'linux.coves.social',
      'news.coves.social',
    ])
  })

  it('does not record the same entry twice', () => {
    const before = resumables.items.length

    resumables.add(item('linux.coves.social'))

    expect(resumables.items).toHaveLength(before)
    // Asserting the entry is still THERE, once — a list that records nothing
    // at all would satisfy the length check alone.
    expect(
      resumables.items.filter((i) => i.name === 'linux.coves.social'),
    ).toHaveLength(1)
  })
})
