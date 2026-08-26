import { browser } from '$app/environment'
import type {
  CommunityView as CovesCommunityView,
  CommunityViewDetailed,
} from '$lib/api/coves/types'

interface SessionStorage {
  lastSeenCommunity?: CovesCommunityView | CommunityViewDetailed
  postDraft?: {
    community: CovesCommunityView | CommunityViewDetailed | null
    title: string
    body?: string
    image: FileList | null
    url?: string
    nsfw: boolean
    loading: boolean
  }
}

export const setSessionStorage = (
  key: keyof SessionStorage,
  value: SessionStorage[typeof key],
) => {
  if (!browser) return
  if (value == undefined) {
    sessionStorage.removeItem(key)
  } else {
    sessionStorage.setItem(key, JSON.stringify(value))
  }
}

export const getSessionStorage = (
  key: keyof SessionStorage,
): SessionStorage[typeof key] => {
  if (!browser) return
  const raw = sessionStorage.getItem(key)
  if (raw == null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    console.warn(
      `[session] Failed to parse sessionStorage key "${key}", removing corrupted data`,
    )
    sessionStorage.removeItem(key)
    return undefined
  }
}
