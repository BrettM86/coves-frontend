// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'svelte'
import type { PostView } from '$lib/api/coves/types'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/state', () => ({
  page: {
    url: new URL('https://coves.test/c/community.test/post/author.test/one'),
    state: {},
  },
}))
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  invalidate: vi.fn(),
  replaceState: vi.fn(),
}))
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: {
    current: { jwt: 'authenticated', did: 'did:plc:reader' },
    meta: {},
    sessionExpired: false,
  },
}))
const getComments = vi.hoisted(() => vi.fn())
const getPosts = vi.hoisted(() => vi.fn())
vi.mock('$lib/api/client.svelte', () => ({
  coves: () => ({ getComments, getPosts }),
}))
vi.mock('$lib/feature/post', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/feature/post')>()),
  Post: (await import('$lib/feature/post/PostNavigation.test.svelte')).default,
}))
async function svelteClientEntry(subpath: string): Promise<unknown> {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */
    require_.resolve('svelte/package.json').replace('package.json', subpath)
  )
}
vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))
vi.mock('svelte/reactivity', () =>
  svelteClientEntry('src/reactivity/index-client.js'),
)
vi.mock('svelte/transition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/transition')>()),
  fly: () => ({ duration: 0 }),
}))

import { ReactiveState } from '$lib/app/util/reactive.svelte'
import { facetOver } from '$lib/feature/richtext/test-helpers'
import PostPage from './+page.svelte'

const postUri = 'at://did:plc:author/social.coves.community.postv2/one'
const content = '[image]\n\nHello'

const post = {
  uri: postUri,
  cid: 'bafytest',
  rkey: 'one',
  author: { did: 'did:plc:author', handle: 'author.test' },
  community: {
    did: 'did:plc:community',
    handle: 'community.test',
    name: 'Community',
  },
  record: {
    content,
    facets: [
      facetOver(content, '[image]', {
        $type: 'social.coves.richtext.facet#image',
        index: 0,
      }),
    ],
  },
  embed: {
    $type: 'social.coves.embed.images#view',
    images: [
      {
        thumb:
          'https://img.coves.test/img/content_preview/plain/did:plc:a/kite',
        fullsize:
          'https://img.coves.test/img/content_full/plain/did:plc:a/kite',
        alt: 'Kite over the dunes',
      },
    ],
  },
  stats: { upvotes: 0, downvotes: 0, score: 0, commentCount: 0 },
} as unknown as PostView

let target: HTMLDivElement
let client: typeof import('svelte')
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeEach(async () => {
  client = await import('svelte')
  getComments.mockReset()
  getPosts.mockReset()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  vi.unstubAllGlobals()
})

describe('post page title for an untitled post', () => {
  it('leaves the covered text of an accepted image placement out', () => {
    mounted = client.mount(PostPage, {
      target,
      intro: false,
      props: {
        data: {
          data: new ReactiveState({
            post,
            comments: Promise.resolve({ unavailable: true }),
            params: {
              postUri,
              comments: { post: postUri, sort: 'hot', depth: 3, limit: 50 },
              thread: {},
            },
          }),
        } as unknown as ComponentProps<typeof PostPage>['data'],
      },
    })
    client.flushSync()

    expect(document.title.trim()).toBe('Hello')
    expect(
      document.head
        .querySelector('meta[property="og:title"]')
        ?.getAttribute('content'),
    ).toBe('Hello')
  })
})
