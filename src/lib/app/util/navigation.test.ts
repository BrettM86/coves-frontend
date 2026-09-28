import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({
  goto: vi.fn(async (_url: URL) => {}),
}))
vi.mock('$app/navigation', () => navigation)

import { searchParam } from './navigation'

beforeEach(() => {
  navigation.goto.mockClear()
})

describe('searchParam', () => {
  it('navigates to the changed URL', async () => {
    await searchParam(
      new URL('https://coves.test/?type=discover&cursor=abc'),
      'type',
      'timeline',
      'cursor',
    )

    expect(navigation.goto).toHaveBeenCalledTimes(1)
    expect(navigation.goto.mock.calls[0]?.[0].href).toBe(
      'https://coves.test/?type=timeline',
    )
  })

  it('leaves the passed URL unchanged', async () => {
    // Callers pass `page.url`, which is the router's own current URL: changing
    // it in place makes the router see no search-param change, so the loads
    // that read the parameter never rerun.
    const current = new URL('https://coves.test/?type=discover&cursor=abc')

    await searchParam(current, 'type', 'timeline', 'cursor')

    expect(current.href).toBe('https://coves.test/?type=discover&cursor=abc')
    expect(navigation.goto.mock.calls[0]?.[0]).not.toBe(current)
  })
})
