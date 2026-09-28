import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import Avatar from './Avatar.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

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
