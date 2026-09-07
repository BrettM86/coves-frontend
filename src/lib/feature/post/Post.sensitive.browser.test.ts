// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AtUri, CID, PostView } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
const svelteClientEntry = async (subpath: string): Promise<unknown> => {
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

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')

beforeEach(async () => {
  client = await import('svelte')
  const { settings } = await import('$lib/app/state/settings.svelte')
  settings.nsfwBlur = true
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target?.remove()
})

const fixture = (key: string): PostView =>
  ({
    uri: `at://did:plc:author/social.coves.community.post/${key}` as AtUri,
    rkey: key,
    cid: 'bafyreiexample' as CID,
    indexedAt: '2026-09-01T00:00:00Z',
    author: {
      did: 'did:plc:author' as DID,
      handle: 'author.example' as Handle,
    },
    community: { did: 'did:plc:community' as DID, name: 'Community' },
    createdAt: '2026-09-01T00:00:00Z',
    record: {
      $type: 'social.coves.community.post',
      title: 'Post title',
      author: 'did:plc:author',
      community: 'did:plc:community',
      createdAt: '2026-09-01T00:00:00Z',
      labels: { values: [{ val: 'nsfw' }] },
    },
    embed: {
      $type: 'social.coves.embed.images#view',
      images: [
        {
          image: 'https://media.example/sensitive-image.jpg',
          thumb: 'https://media.example/sensitive-thumbnail.jpg',
          fullsize: 'https://media.example/sensitive-image.jpg',
          alt: 'Sensitive image',
        },
      ],
    },
  }) as PostView

async function mountPost(
  view: 'cozy' | 'compact' = 'compact',
  expandBody = false,
) {
  const { SvelteMap } = await import('svelte/reactivity')
  const Post = (await import('./Post.svelte')).default
  const values = new SvelteMap([['post', fixture('one')]])
  const props = {
    get post(): PostView {
      const post = values.get('post')
      if (!post) throw new Error('Missing post fixture')
      return post
    },
    set post(post: PostView) {
      values.set('post', post)
    },
    actions: false,
    view,
    expandBody,
  }
  mounted = client.mount(Post, { target, props, intro: false })
  client.flushSync()
  return props
}

function toggle(name: string): HTMLButtonElement {
  const button = [...target.querySelectorAll('button')].find(
    (element) => element.getAttribute('aria-label') === name,
  )
  expect(button, `native button named ${name}`).toBeDefined()
  if (!button) throw new Error(`Missing ${name} button`)
  return button
}

function previewToggle(): HTMLButtonElement {
  const button = [
    ...target.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Show sensitive content"]',
    ),
  ].find((element) => element.querySelector('img'))
  expect(button, 'image-bearing reveal button').toBeDefined()
  if (!button) throw new Error('Missing native preview button')
  return button
}

it('provides a focusable reveal control and lets the viewer hide media again', async () => {
  await mountPost()
  expect(target.querySelector('img:not([aria-hidden="true"])')).toBeNull()
  const show = toggle('Show sensitive content')
  expect(show.tabIndex).toBe(0)
  show.focus()
  expect(document.activeElement).toBe(show)
  show.click()
  client.flushSync()
  expect(target.querySelector('img[alt="Sensitive image"]')).not.toBeNull()
  toggle('Hide sensitive content').click()
  client.flushSync()
  expect(target.querySelector('img:not([aria-hidden="true"])')).toBeNull()
  expect(toggle('Show sensitive content')).toBeDefined()
})

it('requires a new reveal when the component receives a different post with the same media', async () => {
  const props = await mountPost()
  toggle('Show sensitive content').click()
  client.flushSync()
  expect(target.querySelector('img[alt="Sensitive image"]')).not.toBeNull()
  props.post = fixture('two')
  client.flushSync()
  expect(target.querySelector('img:not([aria-hidden="true"])')).toBeNull()
  expect(toggle('Show sensitive content')).toBeDefined()
})

it('does not restore an earlier reveal after switching away and back', async () => {
  const props = await mountPost()
  toggle('Show sensitive content').click()
  client.flushSync()
  props.post = fixture('two')
  client.flushSync()
  props.post = fixture('one')
  client.flushSync()
  expect(target.querySelector('img[alt="Sensitive image"]')).toBeNull()
  expect(toggle('Show sensitive content')).toBeDefined()
})

it('reveals and re-hides body text and inline images together with media', async () => {
  const props = await mountPost('cozy')
  const post = fixture('body')
  if (!post.record) throw new Error('Missing post record')
  post.record.content =
    'Sensitive body details\n\n![Body image](https://media.example/body-image.jpg)'
  props.post = post
  client.flushSync()
  expect(target.textContent).not.toContain('Sensitive body details')
  expect(target.querySelector('img[src*="body-image"]')).toBeNull()
  toggle('Show sensitive content').click()
  client.flushSync()
  expect(target.textContent).toContain('Sensitive body details')
  expect(target.querySelector('img[src*="body-image"]')).not.toBeNull()
  toggle('Hide sensitive content').click()
  client.flushSync()
  expect(target.textContent).not.toContain('Sensitive body details')
  expect(target.querySelector('img[src*="body-image"]')).toBeNull()
})

it.each(['compact', 'cozy'] as const)(
  'keeps %s content revealed when a refreshed post object has the same URI',
  async (view) => {
    const props = await mountPost(view)
    toggle('Show sensitive content').click()
    client.flushSync()
    expect(target.querySelector('img[alt="Sensitive image"]')).not.toBeNull()
    props.post = {
      ...fixture('one'),
      viewer: { saved: true },
      stats: { upvotes: 3, downvotes: 0, score: 3, commentCount: 1 },
    }
    client.flushSync()
    expect(target.querySelector('img[alt="Sensitive image"]')).not.toBeNull()
    expect(toggle('Hide sensitive content')).toBeDefined()
  },
)

it('shows the NSFW Content row with Show and Hide actions', async () => {
  const props = await mountPost('cozy')
  props.post = {
    ...fixture('link'),
    embed: {
      $type: 'social.coves.embed.external#view',
      external: { uri: 'https://example.com/article', title: 'Article' },
    },
  }
  client.flushSync()
  const show = toggle('Show sensitive content')
  expect(show.textContent).toContain('NSFW Content')
  expect(show.textContent).toMatch(/\bShow\b/)
  show.click()
  client.flushSync()
  const hide = toggle('Hide sensitive content')
  expect(hide.textContent).toContain('NSFW Content')
  expect(hide.textContent).toMatch(/\bHide\b/)
})

it.each(['compact', 'cozy'] as const)(
  'shows a decorative blurred native-image thumbnail in %s view',
  async (view) => {
    await mountPost(view)
    const show = previewToggle()
    expect(show.textContent).toContain('NSFW Content')
    expect(show.textContent).toMatch(/\bShow\b/)
    expect(show.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(show.querySelector('button, a')).toBeNull()
    const preview = show.querySelector('img')
    expect(preview).not.toBeNull()
    expect(preview?.getAttribute('src')).toContain('sensitive-thumbnail.jpg')
    expect(preview?.getAttribute('alt')).toBe('')
    expect(preview?.getAttribute('aria-hidden')).toBe('true')
    expect(preview?.style.filter).toMatch(/^blur\(\d+px\)$/)
    expect(target.querySelector('picture, source')).toBeNull()
    expect(target.innerHTML).not.toContain('sensitive-image.jpg')
  },
)

it('keeps keyboard focus on the sensitive-content toggle across image reveal and hide', async () => {
  await mountPost('cozy')
  const show = toggle('Show sensitive content')
  show.focus()
  expect(document.activeElement).toBe(show)
  show.click()
  client.flushSync()
  const hide = toggle('Hide sensitive content')
  expect(document.activeElement).toBe(hide)
  hide.click()
  client.flushSync()
  expect(document.activeElement).toBe(toggle('Show sensitive content'))
})

it.each(['compact', 'cozy'] as const)(
  'keeps a persistent banner above the %s preview and reveals from either control',
  async (view) => {
    await mountPost(view)
    expect(
      target.querySelectorAll('button[aria-label="Show sensitive content"]'),
    ).toHaveLength(2)
    const banner = toggle('Show sensitive content')
    const overlay = previewToggle()
    expect(banner).not.toBe(overlay)
    expect(banner.querySelector('img')).toBeNull()
    expect(
      banner.compareDocumentPosition(overlay) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    banner.click()
    client.flushSync()
    expect(toggle('Hide sensitive content')).toBe(banner)
    expect(target.querySelector('img[alt="Sensitive image"]')).not.toBeNull()
    banner.click()
    client.flushSync()
    const restoredOverlay = previewToggle()
    restoredOverlay.focus()
    restoredOverlay.click()
    client.flushSync()
    await client.tick()
    expect(toggle('Hide sensitive content')).toBe(banner)
    expect(document.activeElement).toBe(banner)
    expect(target.querySelector('img[alt="Sensitive image"]')).not.toBeNull()
    banner.click()
    client.flushSync()
    expect(previewToggle()).toBeDefined()
    expect(document.activeElement).toBe(banner)
  },
)

it.each([false, true])(
  'reveals overflowing post bodies with detail expansion=%s',
  async (expandBody) => {
    // jsdom has no layout; model a body that exceeds PostBody's height boundary.
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(600)
    const props = await mountPost('cozy', expandBody)
    const post = fixture('long-body')
    if (!post.record) throw new Error('Missing post record')
    post.record.content = 'Long paragraph. '.repeat(100) + ' END_OF_FULL_BODY'
    props.post = post
    client.flushSync()
    expect(target.textContent).not.toContain('Long paragraph.')
    for (let reveal = 0; reveal < 2; reveal++) {
      toggle('Show sensitive content').click()
      client.flushSync()
      await client.tick()
      client.flushSync()
      if (expandBody) {
        expect(target.textContent).toContain('END_OF_FULL_BODY')
        expect(target.querySelector('button[title="Expand"]')).toBeNull()
        expect(
          target.querySelector('section')?.classList.contains('max-h-36'),
        ).toBe(false)
      } else {
        expect(target.textContent).not.toContain('END_OF_FULL_BODY')
        expect(target.querySelector('button[title="Expand"]')).not.toBeNull()
      }
      toggle('Hide sensitive content').click()
      client.flushSync()
      expect(target.textContent).not.toContain('Long paragraph.')
    }
  },
)
