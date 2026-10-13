import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import type { CommunityRef } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import type { PostUnavailableKind } from './owner'
import PostUnavailable from './PostUnavailable.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

function markup(kind: PostUnavailableKind, community?: CommunityRef): string {
  return render(PostUnavailable, { props: { kind, community } }).body
}

/** Markup reduced to its visible text, whitespace collapsed. */
function text(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

describe('PostUnavailable', () => {
  it.each([
    {
      kind: 'moderated',
      title: 'Post removed',
      description: 'Removed by server admin.',
    },
    {
      kind: 'removed',
      title: 'Post removed',
      description: "Removed by the community's moderators.",
    },
    {
      kind: 'blocked',
      title: 'Post unavailable',
      description: "You've blocked this post's author.",
    },
    {
      kind: 'notFound',
      title: 'Post unavailable',
      description:
        "This post may have been removed, or it isn't available yet.",
    },
  ] as const)('explains a $kind post', ({ kind, title, description }) => {
    const visible = text(markup(kind))
    expect(visible).toContain(title)
    expect(visible).toContain(description)
  })

  it('names the community of a moderated post without exposing its author', () => {
    const html = markup('moderated', {
      did: 'did:plc:linuxcommunity' as DID,
      handle: 'linux.coves.social' as Handle,
      name: 'linux',
    })
    const visible = text(html)
    expect(visible).toContain('linux')
    expect(visible).toContain('Removed by server admin.')
    expect(html).not.toContain('did:plc:')
    expect(html).not.toMatch(/<img\b/)
  })
})
