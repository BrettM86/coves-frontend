/**
 * The resumables list must not accumulate on the server.
 *
 * `resumables` is a module-level "jump back in" list. In the browser it is one
 * person's recent history. On the server it is shared by every visitor, so
 * anything pushed during a render leaks the communities and posts one visitor
 * was reading to everyone rendered afterwards.
 *
 * Both tests run against the module-level singleton components actually read,
 * not a fresh import — and the second deliberately runs after the first,
 * because that is the relationship two consecutive server renders have.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('$app/environment', () => ({
  browser: false,
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

describe('resumables during a server render', () => {
  it('retains nothing a render adds', () => {
    resumables.add(item('news.coves.social'))
    resumables.add(item('private.coves.social'))

    expect(resumables.items).toHaveLength(0)
  })

  it('leaves nothing behind for the next render to find', () => {
    expect(JSON.stringify(resumables.items)).not.toContain(
      'private.coves.social',
    )
  })
})
