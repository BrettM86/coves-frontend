import { describe, expect, it, vi } from 'vitest'

vi.mock('$app/state', () => ({
  page: { url: new URL('https://coves.example/') },
}))
vi.mock('$lib/app/state/i18n', () => ({
  t: { get: (_key: string, values?: { default?: string }) => values?.default },
}))
vi.mock('$lib/app/state/settings.svelte', () => ({ settings: {} }))
vi.mock('$lib/app/state/theme/theme.svelte', () => ({ theme: {} }))
vi.mock('$lib/feature/user/logout', () => ({ logout: vi.fn() }))

import { dynamicActions } from './actions.svelte'

describe('dynamicActions', () => {
  it('round-trips the complete search query through its URL', () => {
    const query = 'cats & dogs #pets 日本語'
    const [action] = dynamicActions(query).actions
    if (!action?.href) throw new Error('Missing search action URL')

    const url = new URL(action.href, 'https://coves.example')
    expect(url.searchParams.get('q')).toBe(query)
  })
})
