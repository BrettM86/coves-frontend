import { describe, expect, it } from 'vitest'
import { mergeDeep } from './merge'

describe('mergeDeep', () => {
  it('overwrites known primitive keys', () => {
    const target = { view: 'compact', infiniteScroll: true }
    expect(mergeDeep(target, { view: 'cozy' })).toEqual({
      view: 'cozy',
      infiniteScroll: true,
    })
  })

  it('merges nested objects without dropping untouched siblings', () => {
    const target = { embeds: { clickToView: true, youtube: 'youtube' } }
    expect(mergeDeep(target, { embeds: { youtube: 'piped' } })).toEqual({
      embeds: { clickToView: true, youtube: 'piped' },
    })
  })

  it('prunes keys the target does not define', () => {
    const target = { view: 'compact' }
    expect(mergeDeep(target, { view: 'cozy', displayNames: false })).toEqual({
      view: 'cozy',
    })
  })

  it('prunes retired keys nested inside a known object', () => {
    const target = { expand: { communities: true } }
    expect(
      mergeDeep(target, { expand: { communities: false, moderates: true } }),
    ).toEqual({ expand: { communities: false } })
  })

  it('assigns over a key whose default is undefined', () => {
    const target: Record<string, unknown> = { modlogCardView: undefined }
    expect(mergeDeep(target, { modlogCardView: true })).toEqual({
      modlogCardView: true,
    })
  })

  it('assigns over a key whose default is null', () => {
    const target: Record<string, unknown> = { language: null }
    expect(mergeDeep(target, { language: 'en' })).toEqual({ language: 'en' })
  })

  it('replaces arrays wholesale rather than merging by index', () => {
    const target = { presets: [{ title: 'Preset 1', content: 'a' }] }
    expect(
      mergeDeep(target, { presets: [{ title: 'Mine', content: 'b' }] }),
    ).toEqual({ presets: [{ title: 'Mine', content: 'b' }] })
  })

  it('drops a stored object where the schema expects a primitive', () => {
    const target: Record<string, unknown> = { view: 'compact' }
    expect(mergeDeep(target, { view: { nested: true } })).toEqual({
      view: 'compact',
    })
  })

  it('drops a stored primitive where the schema expects an object', () => {
    const target = { embeds: { clickToView: true } }
    expect(mergeDeep(target, { embeds: false })).toEqual({
      embeds: { clickToView: true },
    })
  })

  it('drops a stored primitive where the schema expects an array', () => {
    const target = { presets: [{ title: 'Preset 1', content: 'a' }] }
    expect(mergeDeep(target, { presets: false })).toEqual({
      presets: [{ title: 'Preset 1', content: 'a' }],
    })
  })

  it('drops a stored array where the schema expects a primitive', () => {
    const target = { infiniteScroll: true }
    expect(mergeDeep(target, { infiniteScroll: [] })).toEqual({
      infiniteScroll: true,
    })
  })

  it('drops a stored value of the wrong primitive type', () => {
    const target = { view: 'compact', nsfwBlur: true }
    expect(mergeDeep(target, { view: 3, nsfwBlur: 'yes' })).toEqual({
      view: 'compact',
      nsfwBlur: true,
    })
  })

  it('accepts any non-object over a null or undefined default', () => {
    const target: Record<string, unknown> = {
      language: null,
      modlogCardView: undefined,
      logoColorMonth: null,
    }
    expect(
      mergeDeep(target, {
        language: 'en',
        modlogCardView: true,
        logoColorMonth: 7,
      }),
    ).toEqual({ language: 'en', modlogCardView: true, logoColorMonth: 7 })
  })

  it('drops a stored object over a null or undefined default', () => {
    const target: Record<string, unknown> = { language: null }
    expect(mergeDeep(target, { language: { nested: true } })).toEqual({
      language: null,
    })
  })

  it('preserves undefined-valued defaults through a structuredClone round trip', () => {
    // The settings loader clones the defaults before merging. It must use
    // structuredClone: a JSON round trip drops undefined-valued keys, which
    // this allow-list merge would then treat as unknown and discard, silently
    // wiping stored values like a custom Invidious host.
    const defaults = { embeds: { invidious: undefined, youtube: 'youtube' } }
    const stored = { embeds: { invidious: 'https://yewtu.be' } }

    expect(mergeDeep(structuredClone(defaults), stored)).toEqual({
      embeds: { invidious: 'https://yewtu.be', youtube: 'youtube' },
    })
    expect(
      mergeDeep(
        JSON.parse(JSON.stringify(defaults)) as typeof defaults,
        stored,
      ),
    ).toEqual({ embeds: { youtube: 'youtube' } })
  })

  it('ignores a __proto__ payload without polluting Object.prototype', () => {
    const target: Record<string, unknown> = { view: 'compact' }
    const payload = JSON.parse('{"__proto__":{"polluted":"yes"}}') as unknown

    mergeDeep(target, payload)

    expect(target).toEqual({ view: 'compact' })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('applies multiple sources left to right', () => {
    const target = { view: 'compact', nsfwBlur: true }
    expect(
      mergeDeep(target, { view: 'cozy' }, { view: 'compact', nsfwBlur: false }),
    ).toEqual({ view: 'compact', nsfwBlur: false })
  })

  it('returns the target untouched when there are no sources', () => {
    const target = { view: 'compact' }
    expect(mergeDeep(target)).toEqual({ view: 'compact' })
  })

  it('ignores non-object sources', () => {
    const target = { view: 'compact' }
    expect(mergeDeep(target, null, 'nonsense', 42)).toEqual({ view: 'compact' })
  })
})
