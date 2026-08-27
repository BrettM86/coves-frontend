import { describe, expect, it, vi } from 'vitest'

// Regression test for the auth ↔ instance module cycle. Native ESM evaluates
// a page's imports depth-first, so a page whose first state import is
// `instance.svelte` (e.g. /login importing LINKED_INSTANCE_URL) evaluates
// `auth.svelte` — and its module-scope `new Profile()` — before
// `instance.svelte`'s own body has run. That used to throw a TDZ
// ReferenceError on `DEFAULT_INSTANCE_URL` for any fresh browser profile.
// This test deliberately uses the REAL modules, in that entry order, with no
// stored profile data.
vi.mock('$app/environment', () => ({
  browser: false,
  building: false,
  dev: true,
}))

vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.example' },
}))

describe('instance.svelte ↔ auth.svelte import order', () => {
  it('builds the guest profile when instance.svelte is the entry module', async () => {
    const instanceMod = await import('./instance.svelte')
    const authMod = await import('./auth.svelte')

    expect(instanceMod.DEFAULT_INSTANCE_URL).toBe('https://coves.example')
    expect(authMod.profile.current.instance).toBe('https://coves.example')
    expect(instanceMod.instance.data).toBe('https://coves.example')
  })
})
