// @vitest-environment jsdom
import { createRequire } from 'node:module'
import { flushSync, mount, unmount } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { expect, it, vi } from 'vitest'
import AnimatedStar from './AnimatedStar.svelte'

vi.mock('svelte', async () => {
  const entry = createRequire(import.meta.url)
    .resolve('svelte/package.json')
    .replace('package.json', 'src/index-client.js')
  return import(/* @vite-ignore */ entry)
})

vi.mock('svelte/reactivity', async () => {
  const entry = createRequire(import.meta.url)
    .resolve('svelte/package.json')
    .replace('package.json', 'src/reactivity/index-client.js')
  return import(/* @vite-ignore */ entry)
})

it('throws one spark per tip on starring and clears the burst on undo', async () => {
  const target = document.createElement('div')
  const state = new SvelteMap([['starred', false]])
  const component = mount(AnimatedStar, {
    target,
    props: {
      get starred() {
        return state.get('starred') ?? false
      },
    },
  })
  try {
    flushSync()
    expect(target.querySelectorAll('.spark')).toHaveLength(0)
    state.set('starred', true)
    flushSync()
    expect(target.querySelectorAll('.spark')).toHaveLength(5)
    state.set('starred', false)
    flushSync()
    expect(target.querySelectorAll('.spark')).toHaveLength(0)
  } finally {
    await unmount(component)
  }
})
