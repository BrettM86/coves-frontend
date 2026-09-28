import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const Subject = (await import('./VirtualListHeight.test.svelte')).default

describe('VirtualList server render', () => {
  it('renders the first rows in flow, with no fixed height to hydrate against', () => {
    const items = Array.from({ length: 20 }, (_, index) => index)

    const { body } = render(Subject, { props: { items } })

    // Every row of a first page is in the markup: the browser keeps these
    // through hydration instead of rebuilding them.
    for (const index of items) expect(body).toContain(`Row ${index}`)
    // A height from estimates would clip or overlap real rows before the
    // browser has measured them.
    expect(body).not.toMatch(/position: relative;\s*height:/)
  })
})
