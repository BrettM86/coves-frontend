import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AVATAR_POOL,
  DEFAULT_AVATAR_TINTS,
  defaultAvatar,
  sha256,
} from './default-avatar'

const mockEnv = vi.hoisted((): { PUBLIC_INSTANCE_URL?: string } => ({
  PUBLIC_INSTANCE_URL: 'https://coves.social',
}))
vi.mock('$env/dynamic/public', () => ({ env: mockEnv }))

function hexPrefix(bytes: Uint8Array, length: number): string {
  return Array.from(bytes.slice(0, length), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

// PRD_DEFAULT_AVATARS §4.2 test vectors, plus a long did:web with mixed case
// (no normalisation, digest input longer than one SHA-256 block).
const VECTORS = [
  {
    did: 'did:plc:ewvi7nxzyoun6zhxrhs64oiz',
    prefix: '099e4ea96cd62c05',
    pictureIndex: 15,
    slug: 'ocean-wave',
    tintIndex: 5,
    tint: '#D5E6E3',
  },
  {
    did: 'did:plc:z72i7hdynmk6r22z27h6tvur',
    prefix: 'f5b57a549b7ad681',
    pictureIndex: 20,
    slug: 'pufferfish',
    tintIndex: 1,
    tint: '#D8E8D4',
  },
  {
    did: 'did:web:coves.social',
    prefix: 'e5417994bd0f54cd',
    pictureIndex: 23,
    slug: 'sandcastle',
    tintIndex: 5,
    tint: '#D5E6E3',
  },
  {
    did: 'did:web:very-long-user-identity.example.com:users:AliceExamplePerson',
    prefix: '682f1ffe94437882',
    pictureIndex: 37,
    slug: 'treasure-chest',
    tintIndex: 2,
    tint: '#CFE3EC',
  },
]

describe('default avatar assignment (PRD §4.2 vectors)', () => {
  it.each(VECTORS)(
    'hashes $did to digest prefix $prefix',
    ({ did, prefix }) => {
      const digest = sha256(new TextEncoder().encode(did))
      expect(digest).toHaveLength(32)
      expect(hexPrefix(digest, 8)).toBe(prefix)
    },
  )

  it.each(VECTORS)(
    'assigns $did picture $pictureIndex ($slug) and tint $tintIndex ($tint)',
    ({ did, pictureIndex, slug, tintIndex, tint }) => {
      const assigned = defaultAvatar(did, 'https://coves.social')
      expect(assigned.pictureIndex).toBe(pictureIndex)
      expect(assigned.slug).toBe(slug)
      expect(assigned.tintIndex).toBe(tintIndex)
      expect(assigned.tint.toUpperCase()).toBe(tint)
    },
  )
})

describe('sha256 at the padding boundary', () => {
  // Digests from `printf '%s' <input> | sha256sum`. 55 bytes is the longest
  // input that fits one block; 56 and 64 bytes need a second block.
  it.each([
    [55, '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318'],
    [56, 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'],
    [64, 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb'],
  ])('hashes %i bytes of "a"', (length, expected) => {
    const digest = sha256(new TextEncoder().encode('a'.repeat(length)))
    expect(hexPrefix(digest, 32)).toBe(expected)
  })
})

describe('default avatar pool and palette (PRD §4.1)', () => {
  it('is the 39 v1 slugs in order', () => {
    expect([...DEFAULT_AVATAR_POOL]).toEqual([
      'anchor',
      'beach-bucket-and-spade',
      'branch-of-coral',
      'clownfish',
      'compass',
      'dolphin',
      'eel',
      'hermit-crab-in-a-shell',
      'jellyfish',
      'kelp-frond',
      'life-ring',
      'lighthouse',
      'message-in-a-bottle',
      'narwhal',
      'nudibranch-sea-slug',
      'ocean-wave',
      'octopus',
      'oyster-with-a-pearl',
      'pelican',
      'penguin',
      'pufferfish',
      'puffin',
      'sand-dollar',
      'sandcastle',
      'scallop-shell',
      'sea-anemone',
      'sea-otter',
      'sea-turtle',
      'sea-urchin',
      'seahorse',
      'seal',
      'ships-wheel',
      'snorkel-mask',
      'spiral-sea-snail-shell',
      'squid',
      'starfish',
      'swordfish',
      'treasure-chest',
      'whale',
    ])
  })

  it('is the 8 approved tints in order', () => {
    expect(DEFAULT_AVATAR_TINTS.map((tint) => tint.toUpperCase())).toEqual([
      '#F3D9C7',
      '#D8E8D4',
      '#CFE3EC',
      '#E6DDF0',
      '#F4E7C1',
      '#D5E6E3',
      '#EED6DA',
      '#DCE0EA',
    ])
  })
})

describe('default avatar URL (PRD §4.4)', () => {
  const did = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz'

  it.each([
    [
      'https://coves.social',
      'https://coves.social/img/default-avatars/v1/ocean-wave.webp',
    ],
    [
      'http://127.0.0.1:8080/some/path/',
      'http://127.0.0.1:8080/img/default-avatars/v1/ocean-wave.webp',
    ],
  ])('uses the origin of %s', (instanceUrl, expected) => {
    expect(defaultAvatar(did, instanceUrl).url).toBe(expected)
  })

  it('defaults to the PUBLIC_INSTANCE_URL origin', () => {
    expect(defaultAvatar(did).url).toBe(
      'https://coves.social/img/default-avatars/v1/ocean-wave.webp',
    )
  })

  describe('without a usable instance URL', () => {
    afterEach(() => {
      mockEnv.PUBLIC_INSTANCE_URL = 'https://coves.social'
    })

    it('is root-relative when PUBLIC_INSTANCE_URL is unset', () => {
      delete mockEnv.PUBLIC_INSTANCE_URL
      expect(defaultAvatar(did, undefined).url).toBe(
        '/img/default-avatars/v1/ocean-wave.webp',
      )
    })

    it('is root-relative when the instance URL does not parse', () => {
      expect(defaultAvatar(did, 'not a url').url).toBe(
        '/img/default-avatars/v1/ocean-wave.webp',
      )
    })
  })
})
