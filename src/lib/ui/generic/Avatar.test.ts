import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import Avatar from './Avatar.svelte'

vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.social' },
}))

const URL_ = 'https://img.coves.test/img/avatar/plain/did:plc:a/bafyavatar'
const SMALL =
  'https://img.coves.test/img/avatar_small/plain/did:plc:a/bafyavatar'
const LARGE = URL_

function img(width: number): HTMLImageElement {
  const { body } = render(Avatar, { props: { url: URL_, width } })
  const found = new JSDOM(body).window.document.querySelector('img')
  if (!found) throw new Error('Avatar rendered no <img>')
  return found
}

describe('Avatar image size', () => {
  it.each([20, 32, 48, 120])(
    'serves only the 360px variant at %ipx, whatever the screen density',
    (width) => {
      const avatar = img(width)
      expect(avatar.getAttribute('src')).toBe(SMALL)
      expect(avatar.hasAttribute('srcset')).toBe(false)
    },
  )

  it('offers the 1000px variant to dense screens for large avatars', () => {
    expect(img(160).getAttribute('srcset')).toBe(`${SMALL} 1x, ${LARGE} 2x`)
  })

  it('decodes off the main thread', () => {
    expect(img(32).getAttribute('decoding')).toBe('async')
  })
})

// PRD_DEFAULT_AVATARS §4.2 vector: ocean-wave on Seafoam.
const VECTOR_DID = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz'
const VECTOR_URL = 'https://coves.social/img/default-avatars/v1/ocean-wave.webp'

function renderRoot(props: Record<string, unknown>): Element {
  const { body } = render(Avatar, { props: props as never })
  const root = new JSDOM(body).window.document.body.firstElementChild
  if (!root) throw new Error('Avatar rendered nothing')
  return root
}

function backgroundColor(element: Element): string {
  const match = /background-color:\s*([^;]+)/i.exec(
    element.getAttribute('style') ?? '',
  )
  return (match?.[1] ?? '').trim().toUpperCase()
}

describe('Avatar default for a user without an avatar (PRD §4.5)', () => {
  it.each([
    [undefined, 32],
    ['', 32],
    [undefined, 160],
    ['', 160],
  ])(
    'with url %o at %ipx draws the tinted circle and the default picture',
    (url, width) => {
      const root = renderRoot({
        did: VECTOR_DID,
        url,
        width,
        alt: 'Alice',
        title: 'Alice',
        class: 'ring-2',
      })
      expect(root.tagName).toBe('DIV')
      expect(backgroundColor(root)).toBe('#D5E6E3')
      const style = root.getAttribute('style') ?? ''
      expect(style).toContain(`width: ${width}px`)
      expect(style).toContain(`height: ${width}px`)
      expect(root.classList.contains('rounded-full')).toBe(true)
      expect(root.classList.contains('ring-2')).toBe(true)
      expect(root.getAttribute('title')).toBe('Alice')
      expect(root.querySelector('svg')).toBeNull()

      const pictures = root.querySelectorAll('img')
      expect(pictures).toHaveLength(1)
      const picture = pictures[0]
      expect(picture.getAttribute('src')).toBe(VECTOR_URL)
      expect(picture.getAttribute('alt')).toBe('')
      expect(picture.hasAttribute('srcset')).toBe(false)
      expect(picture.classList.contains('object-cover')).toBe(true)
      const fills =
        (picture.classList.contains('w-full') &&
          picture.classList.contains('h-full')) ||
        /width:\s*100%/.test(picture.getAttribute('style') ?? '') ||
        picture.getAttribute('width') === String(width)
      expect(fills).toBe(true)
    },
  )
})

describe('Avatar with an empty DID (PRD D13)', () => {
  it('draws a plain Mist circle with no picture', () => {
    const root = renderRoot({ did: '', url: undefined, width: 32 })
    expect(root.tagName).toBe('DIV')
    expect(backgroundColor(root)).toBe('#DCE0EA')
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('svg')).toBeNull()
  })

  // Guard: a real avatar always wins, even when the DID is empty.
  it('still renders a working real avatar', () => {
    const root = renderRoot({ did: '', url: URL_, width: 32 })
    expect(root.tagName).toBe('IMG')
    expect(root.getAttribute('src')).toBe(SMALL)
  })
})

describe('Avatar without a DID', () => {
  // Guard: communities and other non-user avatars keep DiceBear.
  it('keeps the DiceBear initials fallback', () => {
    const root = renderRoot({ url: undefined, width: 32, alt: 'cats' })
    expect(root.tagName).toBe('DIV')
    expect(root.querySelector('svg')).not.toBeNull()
    expect(root.querySelector('img')).toBeNull()
  })
})
