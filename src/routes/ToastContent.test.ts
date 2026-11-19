// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Toast } from '$lib/ui/kit/toast/toasts'

vi.mock('svelte', async () => {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */
    require_
      .resolve('svelte/package.json')
      .replace('package.json', 'src/index-client.js')
  )
})

vi.mock('$env/dynamic/public', () => ({ env: {} }))

interface SvelteClient {
  mount: (
    component: unknown,
    options: { target: Element; props: unknown },
  ) => unknown
  unmount: (component: unknown) => void
  flushSync: (fn?: () => void) => void
}

let client: SvelteClient | undefined
let mounted: unknown
let target: HTMLElement | undefined

afterEach(() => {
  if (client && mounted) client.unmount(mounted)
  target?.remove()
  mounted = undefined
  target = undefined
})

describe('ToastContent', () => {
  it.each([
    {
      type: 'error',
      content: 'Failed: [verify your account](https://evil.example)',
      forbidden: 'a',
      literal: '[verify your account](https://evil.example)',
    },
    {
      type: 'error',
      content: '![i](https://evil.example/p.png)',
      forbidden: 'img',
      literal: '![i](https://evil.example/p.png)',
    },
    {
      type: 'error',
      content: '**bold**',
      forbidden: 'strong',
      literal: '**bold**',
    },
    {
      type: 'info',
      content: 'Set to **Dark**',
      strongText: 'Dark',
    },
  ] as const)('renders $type toast content $content', async (row) => {
    client = (await import('svelte')) as unknown as SvelteClient
    const { default: ToastContent } = await import('./ToastContent.svelte')
    target = document.createElement('div')
    document.body.appendChild(target)
    const toast: Toast = { id: 1, type: row.type, content: row.content }
    mounted = client.mount(ToastContent, { target, props: { toast } })
    client.flushSync()

    if ('forbidden' in row && row.forbidden !== undefined) {
      expect(target.querySelector(row.forbidden)).toBeNull()
      expect(target.textContent).toContain(row.literal)
    } else {
      expect(target.querySelector('strong')?.textContent).toBe(row.strongText)
    }
  })
})
