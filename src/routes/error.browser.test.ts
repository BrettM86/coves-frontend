// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
const page = vi.hoisted(() => ({
  status: 500,
  error: { code: 'BackendUnavailable', message: 'fetch failed' } as {
    code?: string
    message: string
  },
  url: new URL('http://localhost/c/community.test?sort=new'),
}))
vi.mock('$app/state', () => ({ page }))
vi.mock('$app/navigation', () => ({
  goto: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('$lib/app/state/i18n', () => {
  const translate = (key: string) => key
  return {
    t: {
      get: translate,
      subscribe: (run: (translator: typeof translate) => void) => {
        run(translate)
        return () => {}
      },
    },
  }
})
const svelteClientEntry = async (subpath: string): Promise<unknown> => {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */ require_
      .resolve('svelte/package.json')
      .replace('package.json', subpath)
  )
}
vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))
vi.mock('svelte/reactivity', () =>
  svelteClientEntry('src/reactivity/index-client.js'),
)

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')

beforeEach(async () => {
  page.error = { code: 'BackendUnavailable', message: 'fetch failed' }
  client = await import('svelte')
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
})

async function mountError() {
  const ErrorPage = (await import('./+error.svelte')).default
  mounted = client.mount(ErrorPage, { target, intro: false })
  client.flushSync()
}

describe('backend-unavailable error page', () => {
  it('explains the outage and retries the complete current URL', async () => {
    await mountError()
    expect(target.querySelector('h1')?.textContent).toBe(
      'error.backend_unreachable_title',
    )
    expect(target.textContent).toContain('error.backend_unreachable')
    expect(target.textContent).not.toContain('fetch failed')
    const retry = [...target.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'message.retry',
    )
    if (!retry) throw new Error('Missing retry button')
    retry.click()
    const { goto } = await import('$app/navigation')
    expect(goto).toHaveBeenCalledWith(page.url, { invalidateAll: true })
    expect(target.querySelector('a[href="/"]')?.textContent).toContain(
      'nav.home',
    )
  })

  it('preserves the status and sanitized message for an unrelated error', async () => {
    page.error = { message: 'An unexpected error occurred' }
    await mountError()
    expect(target.querySelector('h1')?.textContent).toBe('500')
    expect(target.textContent).toContain('An unexpected error occurred')
    expect(target.textContent).not.toContain('error.backend_unreachable_title')
  })
})
