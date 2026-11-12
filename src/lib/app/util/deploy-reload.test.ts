import { describe, expect, it } from 'vitest'
import { deployReloadTarget, type ReloadCandidate } from './deploy-reload'

const from = { url: new URL('https://coves.test/c/nba') }

function nav(overrides: Partial<ReloadCandidate> = {}): ReloadCandidate {
  return {
    type: 'link',
    willUnload: false,
    from,
    to: { url: new URL('https://coves.test/c/rust?sort=new') },
    ...overrides,
  }
}

describe('deployReloadTarget', () => {
  it('loads a link target in full after a deploy', () => {
    expect(deployReloadTarget(true, nav())).toBe(
      'https://coves.test/c/rust?sort=new',
    )
  })

  it('reloads when only the path or only the query changes', () => {
    expect(
      deployReloadTarget(
        true,
        nav({ to: { url: new URL('https://coves.test/c/rust') } }),
      ),
    ).toBe('https://coves.test/c/rust')
    expect(
      deployReloadTarget(
        true,
        nav({ to: { url: new URL('https://coves.test/c/nba?sort=new') } }),
      ),
    ).toBe('https://coves.test/c/nba?sort=new')
  })

  it('reloads a link to an anchor on another page', () => {
    expect(
      deployReloadTarget(
        true,
        nav({ to: { url: new URL('https://coves.test/c/rust#rules') } }),
      ),
    ).toBe('https://coves.test/c/rust#rules')
    expect(
      deployReloadTarget(
        true,
        nav({ to: { url: new URL('https://coves.test/c/nba?sort=new#top') } }),
      ),
    ).toBe('https://coves.test/c/nba?sort=new#top')
  })

  it('reloads a link that drops the anchor from the current page', () => {
    expect(
      deployReloadTarget(
        true,
        nav({
          from: { url: new URL('https://coves.test/c/nba#comments') },
          to: { url: new URL('https://coves.test/c/nba') },
        }),
      ),
    ).toBe('https://coves.test/c/nba')
  })

  it('reloads a link to the current page', () => {
    expect(
      deployReloadTarget(
        true,
        nav({ to: { url: new URL('https://coves.test/c/nba') } }),
      ),
    ).toBe('https://coves.test/c/nba')
  })

  it('leaves goto and form navigations to the router', () => {
    // goto callers may pass replaceState or state, or show a toast first;
    // a full load would drop all three.
    expect(deployReloadTarget(true, nav({ type: 'goto' }))).toBeUndefined()
    expect(deployReloadTarget(true, nav({ type: 'form' }))).toBeUndefined()
  })

  it('leaves navigation alone while the build is current', () => {
    expect(deployReloadTarget(false, nav())).toBeUndefined()
  })

  it('leaves navigations that already unload the page alone', () => {
    expect(deployReloadTarget(true, nav({ willUnload: true }))).toBeUndefined()
    expect(
      deployReloadTarget(true, nav({ type: 'leave', to: null })),
    ).toBeUndefined()
  })

  it('leaves back and forward navigation alone', () => {
    expect(deployReloadTarget(true, nav({ type: 'popstate' }))).toBeUndefined()
  })

  it('leaves a jump within the same page alone', () => {
    expect(
      deployReloadTarget(
        true,
        nav({ to: { url: new URL('https://coves.test/c/nba#comments') } }),
      ),
    ).toBeUndefined()
  })
})
