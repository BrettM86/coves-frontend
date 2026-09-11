// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DID, Handle } from '$lib/types/atproto'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/login'), route: { id: '/login' } },
}))
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  replaceState: vi.fn(),
}))
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
// jsdom has no Web Animations API. Keep error rendering, without transitions.
vi.mock('svelte/transition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/transition')>()),
  slide: () => ({ duration: 0 }),
  fly: () => ({ duration: 0 }),
}))

const createPost = vi.hoisted(() => vi.fn())
vi.mock('$lib/api/client.svelte', () => ({
  coves: () => ({ createPost }),
}))

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')

beforeEach(async () => {
  createPost.mockReset()
  client = await import('svelte')
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  vi.unstubAllGlobals()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function submit() {
  const form = target.querySelector('form')
  if (!form) throw new Error('Missing form')
  // Dispatch at the form boundary: Enter/requestSubmit can reach the handler
  // independently of a click, including before Svelte updates the button.
  const event = new Event('submit', { bubbles: true, cancelable: true })
  form.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
}

function submitButton() {
  const button = target.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )
  if (!button) throw new Error('Missing submit button')
  return button
}

async function mountLogin() {
  const Login = (await import('./login/+page.svelte')).default
  mounted = client.mount(Login, { target, intro: false })
  client.flushSync()
  const handle = target.querySelector<HTMLInputElement>('#handle')
  if (!handle) throw new Error('Missing handle input')
  handle.value = 'alice.test'
  handle.dispatchEvent(new Event('input', { bubbles: true }))
  client.flushSync()
}

async function mountPost() {
  const PostForm = (await import('$lib/feature/post/form/PostForm.svelte'))
    .default
  const { PostFormState } =
    await import('$lib/feature/post/form/post-form.svelte')
  const onsubmit = vi.fn()
  mounted = client.mount(PostForm, {
    target,
    intro: false,
    props: {
      init: new PostFormState({
        title: 'A post',
        community: {
          did: 'did:plc:community' as DID,
          handle: 'community.test' as Handle,
          name: 'Community',
        },
      }),
      onsubmit,
    },
  })
  client.flushSync()
  return onsubmit
}

describe('login submission', () => {
  it('ignores repeated submits during the request and through OAuth redirection', async () => {
    const response = deferred<Response>()
    const fetchLogin = vi.fn(() => response.promise)
    vi.stubGlobal('fetch', fetchLogin)
    await mountLogin()
    submit()
    submit()
    expect(fetchLogin).toHaveBeenCalledTimes(1)
    client.flushSync()
    expect(submitButton().disabled).toBe(true)

    response.resolve(Response.json({ redirectUrl: '#oauth' }))
    await vi.waitFor(() => expect(window.location.hash).toBe('#oauth'))
    submit()
    expect(fetchLogin).toHaveBeenCalledTimes(1)
    expect(submitButton().disabled).toBe(true)
  })

  it('allows retry after a failed login request', async () => {
    const response = deferred<Response>()
    const fetchLogin = vi.fn(() => response.promise)
    vi.stubGlobal('fetch', fetchLogin)
    await mountLogin()
    submit()
    client.flushSync()
    expect(submitButton().disabled).toBe(true)
    response.reject(new Error('Connection failed'))
    await vi.waitFor(() => expect(submitButton().disabled).toBe(false))
    fetchLogin.mockImplementation(() => new Promise<Response>(() => {}))
    submit()
    expect(fetchLogin).toHaveBeenCalledTimes(2)
  })
})

describe('post submission', () => {
  it('creates one post and invokes completion once for repeated submits', async () => {
    const response = deferred<{ uri: string; cid: string }>()
    createPost.mockReturnValue(response.promise)
    const onsubmit = await mountPost()
    submit()
    submit()
    await vi.waitFor(() => expect(createPost).toHaveBeenCalled())
    expect(createPost).toHaveBeenCalledTimes(1)
    client.flushSync()
    expect(submitButton().disabled).toBe(true)
    submit()
    response.resolve({
      uri: 'at://did:plc:author/social.coves.community.post/one',
      cid: 'bafytest',
    })
    await vi.waitFor(() => expect(onsubmit).toHaveBeenCalledTimes(1))
    expect(createPost).toHaveBeenCalledTimes(1)
    expect(submitButton().disabled).toBe(true)
  })

  it('allows retry after a failed post request', async () => {
    const response = deferred<{ uri: string; cid: string }>()
    createPost.mockReturnValue(response.promise)
    const onsubmit = await mountPost()
    submit()
    await vi.waitFor(() => expect(createPost).toHaveBeenCalledTimes(1))
    client.flushSync()
    expect(submitButton().disabled).toBe(true)
    response.reject(new Error('Connection failed'))
    await vi.waitFor(() => expect(submitButton().disabled).toBe(false))
    expect(onsubmit).not.toHaveBeenCalled()
    createPost.mockResolvedValue({
      uri: 'at://did:plc:author/social.coves.community.post/retry',
      cid: 'bafyretry',
    })
    submit()
    await vi.waitFor(() => expect(onsubmit).toHaveBeenCalledTimes(1))
    expect(createPost).toHaveBeenCalledTimes(2)
  })
})

describe('post creation completion', () => {
  it('keeps the create page locked through navigation to the new post', async () => {
    const { goto } = await import('$app/navigation')
    const navigation = deferred<void>()
    vi.mocked(goto).mockReset().mockReturnValue(navigation.promise)
    sessionStorage.setItem(
      'lastSeenCommunity',
      JSON.stringify({
        did: 'did:plc:community',
        handle: 'community.test',
        name: 'Community',
      }),
    )
    createPost.mockResolvedValue({
      uri: 'at://did:plc:author/social.coves.community.post/one',
      cid: 'bafytest',
    })
    const { PostFormState } =
      await import('$lib/feature/post/form/post-form.svelte')
    const submitPost = vi.spyOn(PostFormState.prototype, 'submit')
    const CreatePost = (await import('./create/post/+page.svelte')).default
    mounted = client.mount(CreatePost, { target, intro: false })
    client.flushSync()
    const title =
      target.querySelector<HTMLTextAreaElement>('textarea[required]')
    if (!title) throw new Error('Missing post title')
    title.value = 'Navigation race'
    title.dispatchEvent(new Event('input', { bubbles: true }))
    client.flushSync()

    submit()
    await vi.waitFor(() => expect(goto).toHaveBeenCalledTimes(1))
    client.flushSync()
    submit()
    expect(submitPost).toHaveBeenCalledTimes(1)
    expect(submitButton().disabled).toBe(true)
    expect(createPost).toHaveBeenCalledTimes(1)

    navigation.resolve()
    await navigation.promise
    await client.tick()
    submit()
    expect(submitPost).toHaveBeenCalledTimes(1)
    expect(submitButton().disabled).toBe(true)
  })

  it('does not allow another create when the completion callback throws', async () => {
    createPost.mockResolvedValue({
      uri: 'at://did:plc:author/social.coves.community.post/one',
      cid: 'bafytest',
    })
    const { PostFormState } =
      await import('$lib/feature/post/form/post-form.svelte')
    const submitPost = vi.spyOn(PostFormState.prototype, 'submit')
    const onsubmit = await mountPost()
    onsubmit.mockImplementation(() => {
      throw new Error('Navigation failed')
    })

    submit()
    await vi.waitFor(() =>
      expect(target.textContent).toContain('Navigation failed'),
    )
    submit()
    expect(submitPost).toHaveBeenCalledTimes(1)
    expect(submitButton().disabled).toBe(true)
    expect(createPost).toHaveBeenCalledTimes(1)
    expect(onsubmit).toHaveBeenCalledTimes(1)
  })
})
