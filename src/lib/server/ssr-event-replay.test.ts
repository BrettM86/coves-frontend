import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { render } from 'svelte/server'
import svelteConfig from '../../../svelte.config.js'
import Avatar from '$lib/ui/generic/Avatar.svelte'

// ---------------------------------------------------------------------------
// Svelte's SSR compiler stamps `onload="this.__e=event"` / `onerror="..."` on
// any element with those handlers so an event that fires before hydration is
// stashed and replayed. Inline handler attributes are never nonce-able, so the
// nonce CSP refuses them unless `script-src-attr` carries `'unsafe-hashes'`
// and the sha256 of that exact handler body. It lives in `-attr`, not
// `script-src`, so the exception covers handler attributes only. The hash is pinned to Svelte's internal
// string, so this test renders a real image component and re-derives the hash
// from the emitted markup: a Svelte upgrade that changes the string fails here
// instead of silently disabling every pre-hydration image fallback.
// ---------------------------------------------------------------------------

const directives = svelteConfig.kit?.csp?.directives ?? {}

describe('SSR event replay under the nonce CSP', () => {
  const html = render(Avatar, {
    props: { url: 'https://cdn.test/a.png', width: 32 },
  }).body
  const handler = /\bonerror="([^"]*)"/.exec(html)?.[1]

  it('Svelte still emits the replay attribute on SSR-rendered images', () => {
    expect(handler).toBe('this.__e=event')
  })

  it('script-src-attr allows exactly that handler body by hash, nothing else', () => {
    expect(handler).toBeDefined()
    const digest = createHash('sha256')
      .update(handler ?? '')
      .digest('base64')
    expect(directives['script-src-attr']).toEqual([
      'unsafe-hashes',
      `sha256-${digest}`,
    ])
  })

  it('keeps the hash exception out of script-src', () => {
    expect(directives['script-src']).toEqual(['self'])
  })
})
