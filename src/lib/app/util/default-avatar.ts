import { env } from '$env/dynamic/public'
import { instanceOrigin } from '$lib/app/state/instance/resolve'

/** PRD_DEFAULT_AVATARS §4.1: the v1 pool, in assignment order. */
export const DEFAULT_AVATAR_POOL: readonly string[] = [
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
]

/** PRD_DEFAULT_AVATARS §4.1: Peach, Sage, Sky, Lavender, Sand, Seafoam, Rose, Mist. */
export const DEFAULT_AVATAR_TINTS: readonly string[] = [
  '#F3D9C7',
  '#D8E8D4',
  '#CFE3EC',
  '#E6DDF0',
  '#F4E7C1',
  '#D5E6E3',
  '#EED6DA',
  '#DCE0EA',
]

const ROUND_CONSTANTS = new Uint32Array(64).map((_, index) => {
  // First 32 bits of the fractional parts of the cube roots of the first 64 primes.
  let prime = 2
  for (let found = 0; ; prime++) {
    let isPrime = true
    for (let divisor = 2; divisor * divisor <= prime; divisor++)
      if (prime % divisor === 0) isPrime = false
    if (isPrime && found++ === index) break
  }
  const root = Math.cbrt(prime)
  return Math.floor((root - Math.floor(root)) * 2 ** 32)
})

/**
 * Synchronous SHA-256. `crypto.subtle` is async (and missing in non-secure
 * contexts), and the server render must already carry the default avatar.
 */
export function sha256(bytes: Uint8Array): Uint8Array {
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bytes.length / 0x20000000))
  view.setUint32(paddedLength - 4, (bytes.length * 8) >>> 0)

  const hash = Uint32Array.of(
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  )
  const words = new Uint32Array(64)
  const rotate = (value: number, bits: number) =>
    (value >>> bits) | (value << (32 - bits))
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 64; index++) {
      if (index < 16) {
        words[index] = view.getUint32(offset + index * 4)
        continue
      }
      const early = words[index - 15]
      const late = words[index - 2]
      words[index] =
        words[index - 16] +
        (rotate(early, 7) ^ rotate(early, 18) ^ (early >>> 3)) +
        words[index - 7] +
        (rotate(late, 17) ^ rotate(late, 19) ^ (late >>> 10))
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let index = 0; index < 64; index++) {
      const first =
        (h +
          (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
          ((e & f) ^ (~e & g)) +
          ROUND_CONSTANTS[index] +
          words[index]) >>>
        0
      const second =
        ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) +
          ((a & b) ^ (a & c) ^ (b & c))) >>>
        0
      ;[h, g, f, e, d, c, b, a] = [
        g,
        f,
        e,
        (d + first) >>> 0,
        c,
        b,
        a,
        (first + second) >>> 0,
      ]
    }
    ;[a, b, c, d, e, f, g, h].forEach((value, index) => (hash[index] += value))
  }

  const digest = new Uint8Array(32)
  const digestView = new DataView(digest.buffer)
  hash.forEach((value, index) => digestView.setUint32(index * 4, value))
  return digest
}

export interface DefaultAvatar {
  pictureIndex: number
  slug: string
  tintIndex: number
  tint: string
  url: string
}

/** PRD_DEFAULT_AVATARS §4.2 assignment and §4.4 URL for a user's DID. */
export function defaultAvatar(
  did: string,
  instanceUrl: string | null | undefined = env.PUBLIC_INSTANCE_URL,
): DefaultAvatar {
  const digestView = new DataView(sha256(new TextEncoder().encode(did)).buffer)
  const pictureIndex = digestView.getUint32(0) % DEFAULT_AVATAR_POOL.length
  const tintIndex = digestView.getUint32(4) % DEFAULT_AVATAR_TINTS.length
  const slug = DEFAULT_AVATAR_POOL[pictureIndex]
  const origin = instanceOrigin(instanceUrl ?? undefined) ?? ''
  return {
    pictureIndex,
    slug,
    tintIndex,
    tint: DEFAULT_AVATAR_TINTS[tintIndex],
    url: `${origin}/img/default-avatars/v1/${slug}.webp`,
  }
}
