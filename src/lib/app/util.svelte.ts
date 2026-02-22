import { browser } from '$app/environment'
import { goto } from '$app/navigation'
import { client } from '$lib/api/client.svelte'
import type {
  AuthorView,
  CommunityRef,
  CommunityView as CovesCommunityView,
} from '$lib/api/coves/types'
import { SvelteURL } from 'svelte/reactivity'
import { t } from './i18n'

// Finds the smallest number in `numbers` that is >= target.
// Falls back to the closest number below target if none are >=.
export const findClosestNumber = (numbers: number[], target: number): number =>
  numbers.reduce((prev, curr) =>
    curr >= target && (prev < target || curr < prev) ? curr : prev,
  )

export const searchParam = async (
  url: URL,
  key: string,
  value: string,
  ...deleteKeys: string[]
): Promise<void> => {
  url.searchParams.set(key, value)
  deleteKeys.forEach((k) => url.searchParams.delete(k))
  try {
    await goto(url, {
      invalidateAll: true,
    })
  } catch (err) {
    console.error('[searchParam] Navigation failed:', err)
  }
}

export const fullCommunityName = (name: string, actorId: string): string => {
  try {
    return `${name}@${new SvelteURL(actorId).hostname}`
  } catch {
    return name
  }
}

/**
 * Strips the "c-" prefix from a community handle to produce a URL-friendly slug.
 *
 * Coves community handles use a "c-" prefix convention (e.g. "c-mycommunity")
 * to distinguish community actors from user actors in the ATProto namespace.
 * Route params and URLs use the bare slug without the prefix.
 */
export function communitySlug(handle: string): string {
  return handle.startsWith('c-') ? handle.slice(2) : handle
}

/**
 * Prepends the "c-" prefix to a URL slug to reconstruct the community handle.
 *
 * Coves community handles use a "c-" prefix convention (e.g. "c-mycommunity")
 * to distinguish community actors from user actors in the ATProto namespace.
 * This reverses {@link communitySlug} for API calls that expect the full handle.
 */
export function communityHandleFromSlug(slug: string): string {
  return slug.startsWith('c-') ? slug : `c-${slug}`
}

export const placeholders = {
  get: (type: 'url' | 'post' | 'body' | 'comment') => {
    switch (type) {
      case 'post':
        return Math.random() < 0.01
          ? 'A C E C* B* G D E E F G F E D C E'
          : t.get('placeholders.title')
      case 'body':
        return t.get('placeholders.body')
      case 'comment':
        return t.get('placeholders.comments')
      case 'url':
        return 'https://example.com'
    }
  },
}

export function moveItem<T>(
  array: T[],
  currentIndex: number,
  newIndex: number,
): T[] {
  if (
    currentIndex < 0 ||
    currentIndex >= array.length ||
    newIndex < 0 ||
    newIndex >= array.length
  ) {
    throw new Error('Invalid index')
  }

  const newArray = [...array]

  // Remove the item from the current index
  const [item] = newArray.splice(currentIndex, 1)

  // Insert the item at the new index
  newArray.splice(newIndex, 0, item)

  return newArray
}

export const DOMAIN_REGEX =
  /^(http(s)?:\/\/)?((?!-)[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,63}(:[0-9]{0,5})?$/g
export const DOMAIN_REGEX_FORMS =
  '(http(s)?://)?((?!-)[A-Za-z0-9]{1,63}.)+[A-Za-z]{2,63}(:[0-9]{0,5})?'

export async function uploadImage(
  image: File | null | undefined,
  instance: string,
  jwt: string,
): Promise<string | undefined> {
  if (!image) return

  const formData = new FormData()
  formData.append('images[]', image)

  const res = await client({ auth: jwt, instanceURL: instance }).uploadImage({
    image: image,
  })

  if (res.url) return res.url
  else throw new Error(`Failed to upload image. ${res.msg}`)
}

export const instanceToURL = (input: string) =>
  input.startsWith('http://') || input.startsWith('https://')
    ? input
    : `https://${input}`

export function canParseUrl(url: string): boolean {
  try {
    new SvelteURL(url)
    return true
  } catch {
    return false
  }
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function fuzzySearch(text: string, pattern: string): number {
  const textLower = text.toLowerCase()
  const patternLower = pattern.toLowerCase()
  let score = 0
  let lastIndex = -1
  let consecutiveBonus = 0

  for (let i = 0; i < patternLower.length; i++) {
    const index = textLower.indexOf(patternLower[i], lastIndex + 1)
    if (index === -1) return 0

    score += 1
    if (index === lastIndex + 1) {
      consecutiveBonus++
      score += consecutiveBonus
    } else {
      consecutiveBonus = 0
    }

    lastIndex = index
  }

  // Bonus for matching start of words
  if (textLower.startsWith(patternLower)) {
    score += 2
  } else if (textLower.includes(' ' + patternLower)) {
    score += 1
  }

  return score
}

export const awaitIfServer = async <T>(
  promise: Promise<T>,
): Promise<{
  data: Promise<T> | T
}> => ({ data: browser ? promise : await promise })

export class ReactiveState<T> {
  value = $state<T>()!

  constructor(initialValue: T) {
    this.value = initialValue as NonNullable<T>
  }
}

export function snapshot<T>(item: T) {
  return $state.snapshot(item)
}

export const isImage = (url: string | undefined): boolean => {
  if (!url) return false
  return /\.(jpeg|jpg|gif|png|svg|bmp|webp|avif)/i.test(url)
}

export const isVideo = (url: string | undefined): boolean => {
  if (!url) return false
  return /\.(mp4|mov|webm|mkv|avi)/i.test(url)
}

/**
 * Generate a link path for a community.
 * Accepts a Coves CommunityRef or CommunityView.
 */
export function communityLink(
  community: CommunityRef | CovesCommunityView,
  prefix: string = '',
): string {
  if ('handle' in community && community.handle) {
    return `${prefix}/c/${encodeURIComponent(communitySlug(community.handle))}`
  }
  return `${prefix}/c/${encodeURIComponent(community.name)}`
}

/**
 * Generate a link path for a user profile.
 * Accepts a Coves AuthorView.
 */
export function userLink(user: AuthorView, prefix: string = ''): string {
  if (user.handle) {
    return `${prefix}/profile/${encodeURIComponent(user.handle)}`
  }
  return `${prefix}/profile/${encodeURIComponent(user.did)}`
}

/**
 * Basic types only, don't use for anything more than basic equality
 */
export function recursiveEqual<T>(a: T, b: T): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object') return false

  if (a == null || b == null) {
    if (a == null && b == null) return true
    else return false
  }

  const keysA = Object.keys(a) as (keyof typeof a)[]
  const keysB = Object.keys(b) as (keyof typeof b)[]

  if (keysA.length != keysB.length) return false

  for (const key of keysA) {
    const valA = a[key]
    const valB = b[key]

    if (typeof valA == 'object' && typeof valB == 'object') {
      const result = recursiveEqual(valA!, valB!)
      if (!result) return false
    } else {
      if (valA != valB) return false
    }
  }

  return true
}
