// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AtUri,
  CID,
  CommentStats,
  CommentViewerState,
  PostStats,
  PostViewerState,
} from '$lib/api/coves/types'

const api = vi.hoisted(() => ({
  createVote: vi.fn(),
  deleteVote: vi.fn(),
}))

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))

vi.mock('$lib/api/client.svelte', () => ({ coves: () => api }))

vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: { current: { jwt: 'authenticated' } },
}))

vi.mock('$lib/ui/kit', () => ({ toast: vi.fn() }))

const svelteClientEntry = async (subpath: string): Promise<unknown> => {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */
    require_.resolve('svelte/package.json').replace('package.json', subpath)
  )
}

vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))

interface SvelteClient {
  mount: (
    component: unknown,
    options: { target: Element; props: unknown; intro?: boolean },
  ) => unknown
  unmount: (component: unknown, options?: { outro?: boolean }) => void
  flushSync: (fn?: () => void) => void
}

class FakeAnimation {
  currentTime = 0
  startTime = 0
  playbackRate = 1
  playState = 'running'
  effect = {
    setKeyframes: () => {},
    getComputedTiming: () => ({ duration: 0 }),
  }
  onfinish: (() => void) | null = null
  play(): void {}
  pause(): void {}
  finish(): void {}
  cancel(): void {}
  commitStyles(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

let client: SvelteClient | undefined
let mounted: unknown
let target: HTMLElement | undefined

afterEach(() => {
  if (mounted && client) client.unmount(mounted, { outro: false })
  mounted = undefined
  target?.remove()
  target = undefined
})

const isVisible = (element: Element): boolean => {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false
  if (!(element instanceof HTMLElement)) return true
  return (
    element.style.display !== 'none' && element.style.visibility !== 'hidden'
  )
}

const visibleExactText = (root: Element, text: string): Text[] => {
  const matches: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    if (
      node instanceof Text &&
      node.data.trim() === text &&
      node.parentElement &&
      isVisible(node.parentElement)
    ) {
      matches.push(node)
    }
    node = walker.nextNode()
  }
  return matches
}

describe('VoteButton', () => {
  it('renders ordered upvote, net score, and optimistic pending downvote controls', async () => {
    api.createVote.mockImplementation(() => new Promise(() => {}))
    api.deleteVote.mockResolvedValue(undefined)

    Object.assign(Element.prototype, {
      animate: () => new FakeAnimation(),
      getAnimations: () => [],
    })

    client = (await import('svelte')) as unknown as SvelteClient
    const [{ default: VoteButton }, { t }] = await Promise.all([
      import('./VoteButton.svelte'),
      import('$lib/app/state/i18n'),
    ])

    const stats: PostStats = {
      upvotes: 7,
      downvotes: 3,
      score: 4,
      commentCount: 2,
    }
    const viewer: PostViewerState = { saved: false }
    target = document.createElement('div')
    document.body.appendChild(target)
    mounted = client.mount(VoteButton, {
      target,
      intro: false,
      props: {
        uri: 'at://did:plc:a/social.coves.post/1' as AtUri,
        cid: 'bafybeigdyrzt5' as CID,
        stats,
        viewer,
        emptyStats: {
          upvotes: 0,
          downvotes: 0,
          score: 0,
          commentCount: 0,
        } satisfies PostStats,
        emptyViewer: { saved: false } satisfies PostViewerState,
        variant: 'post',
      },
    })
    client.flushSync()

    const controls = Array.from(target.querySelectorAll('button')).filter(
      isVisible,
    )
    expect(controls).toHaveLength(2)

    const [upvote, downvote] = controls
    expect(upvote.getAttribute('aria-label')).toBe(
      t.get('post.actions.vote.upvote'),
    )
    expect(upvote.getAttribute('aria-pressed')).toBe('false')
    expect(upvote.querySelector('svg')).not.toBeNull()
    expect(downvote.getAttribute('aria-label')).toBe(
      t.get('post.actions.vote.downvote'),
    )
    expect(downvote.getAttribute('aria-pressed')).toBe('false')

    let voteGroup: Element | null = upvote.parentElement
    while (voteGroup && !voteGroup.contains(downvote)) {
      voteGroup = voteGroup.parentElement
    }
    expect(voteGroup).not.toBeNull()
    if (!voteGroup) return

    const scores = visibleExactText(voteGroup, '4')
    expect(scores).toHaveLength(1)
    const scoreElement = scores[0].parentElement
    expect(scoreElement).not.toBeNull()
    if (!scoreElement) return

    expect(upvote.contains(scoreElement)).toBe(true)
    expect(downvote.contains(scoreElement)).toBe(false)
    expect(
      Boolean(
        upvote.compareDocumentPosition(scoreElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true)
    expect(
      Boolean(
        scoreElement.compareDocumentPosition(downvote) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true)

    downvote.click()
    client.flushSync()

    expect(visibleExactText(voteGroup, '3')).toHaveLength(1)
    expect(downvote.getAttribute('aria-pressed')).toBe('true')
    expect(upvote.disabled).toBe(true)
    expect(downvote.disabled).toBe(true)
    expect(voteGroup.getAttribute('aria-busy')).toBe('true')
    expect(voteGroup.querySelector('[role="status"]')).toBeNull()
  }, 15_000)

  it('renders a selected comment downvote without coloring the net score', async () => {
    Object.assign(Element.prototype, {
      animate: () => new FakeAnimation(),
      getAnimations: () => [],
    })

    client = (await import('svelte')) as unknown as SvelteClient
    const [{ default: VoteButton }, { t }] = await Promise.all([
      import('./VoteButton.svelte'),
      import('$lib/app/state/i18n'),
    ])

    const stats: CommentStats = {
      upvotes: 1,
      downvotes: 3,
      score: -2,
      replyCount: 1,
    }
    const viewer: CommentViewerState = {
      vote: 'down',
      voteUri: 'at://did:plc:me/social.coves.vote/1' as AtUri,
    }
    target = document.createElement('div')
    document.body.appendChild(target)
    mounted = client.mount(VoteButton, {
      target,
      intro: false,
      props: {
        uri: 'at://did:plc:a/social.coves.comment/1' as AtUri,
        cid: 'bafybeigdyrzt5' as CID,
        stats,
        viewer,
        emptyStats: {
          upvotes: 0,
          downvotes: 0,
          score: 0,
          replyCount: 0,
        } satisfies CommentStats,
        emptyViewer: {} satisfies CommentViewerState,
        variant: 'comment',
      },
    })
    client.flushSync()

    const voteGroup = target.querySelector('[role="group"]')
    expect(voteGroup).not.toBeNull()
    if (!voteGroup) return

    const controls = Array.from(voteGroup.querySelectorAll('button')).filter(
      isVisible,
    )
    expect(controls).toHaveLength(2)
    const [upvote, downvote] = controls

    expect(upvote.getAttribute('aria-label')).toBe(
      t.get('post.actions.vote.upvote'),
    )
    expect(upvote.getAttribute('aria-pressed')).toBe('false')
    expect(upvote.querySelector('svg.heart-svg')).not.toBeNull()
    expect(downvote.getAttribute('aria-label')).toBe(
      t.get('post.actions.vote.downvote'),
    )
    expect(downvote.getAttribute('aria-pressed')).toBe('true')
    expect(downvote.querySelector('svg.lucide-thumbs-down')).not.toBeNull()
    expect([...downvote.classList]).toEqual(
      expect.arrayContaining(['text-[#0F766E]', 'dark:text-[#63B5B1]']),
    )

    const scores = visibleExactText(voteGroup, '-2')
    expect(scores).toHaveLength(1)
    const scoreElement = scores[0].parentElement
    expect(scoreElement).not.toBeNull()
    if (!scoreElement) return

    const scoreClasses: string[] = []
    let scoreAncestor: Element | null = scoreElement
    while (scoreAncestor && scoreAncestor !== voteGroup) {
      scoreClasses.push(scoreAncestor.getAttribute('class') ?? '')
      scoreAncestor = scoreAncestor.parentElement
    }
    expect(scoreClasses.join(' ')).not.toMatch(/#(?:FF0033|0F766E|63B5B1)/)

    expect(upvote.contains(scoreElement)).toBe(true)
    expect(downvote.contains(scoreElement)).toBe(false)
    expect(
      Boolean(
        upvote.compareDocumentPosition(scoreElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true)
    expect(
      Boolean(
        scoreElement.compareDocumentPosition(downvote) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true)

    expect(voteGroup.getAttribute('aria-label')).toBe('Voting controls')
  }, 15_000)
})
