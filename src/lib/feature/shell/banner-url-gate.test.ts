/**
 * Banner sinks render a server-supplied banner URL into <img src>. Only
 * absolute http(s) URLs may reach that src; anything else falls back to the
 * component's no-banner placeholder.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { CommunityViewDetailed } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import CommunityItemBig from '$lib/feature/community/CommunityItemBig.svelte'
import EntityHeader from './EntityHeader.svelte'
import ProfileHeader from '../../../routes/profile/[handle=actor]/ProfileHeader.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const proxyBanner =
  'https://coves.example/img/banner/plain/did:plc:abc/bafkreiabc'

const sinks = [
  {
    sink: 'CommunityItemBig',
    bannerSelector: '.h-24 img',
    html: (banner: string) =>
      render(CommunityItemBig, {
        props: {
          community: {
            did: 'did:plc:comm' as DID,
            handle: 'gardening.coves.example' as Handle,
            name: 'gardening',
            createdAt: '2026-10-01T00:00:00Z',
            banner,
          } as CommunityViewDetailed,
        },
      }).body,
  },
  {
    sink: 'EntityHeader',
    bannerSelector: '[data-profile-banner] img',
    html: (banner: string) =>
      render(EntityHeader, { props: { name: 'gardening', banner } }).body,
  },
  {
    sink: 'ProfileHeader',
    bannerSelector: '[data-profile-banner] img',
    html: (banner: string) =>
      render(ProfileHeader, {
        props: {
          profile: {
            did: 'did:plc:alice' as DID,
            handle: 'alice.coves.example' as Handle,
            createdAt: '2026-01-01T00:00:00Z',
            banner,
          },
        },
      }).body,
  },
]

const rows = sinks.flatMap((s) => [
  ...['javascript:alert(1)', 'data:text/html,<b>x</b>', '/api/x.png'].map(
    (banner) => ({ ...s, banner, expected: null }),
  ),
  { ...s, banner: proxyBanner, expected: proxyBanner },
])

describe('banner URL gate', () => {
  it.each(rows)(
    '$sink with banner $banner renders src $expected',
    ({ html, banner, bannerSelector, expected }) => {
      const document = new JSDOM(html(banner)).window.document
      const srcs = [...document.querySelectorAll('img')].map(
        (img) => img.getAttribute('src') ?? '',
      )
      const bannerImg = document.querySelector(bannerSelector)
      if (expected === null) {
        expect(srcs.filter((src) => src.includes(banner))).toEqual([])
        expect(bannerImg).toBeNull()
      } else {
        expect(bannerImg?.getAttribute('src')).toBe(expected)
      }
    },
  )
})
