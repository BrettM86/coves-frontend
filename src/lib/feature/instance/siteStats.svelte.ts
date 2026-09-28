import { browser } from '$app/environment'
import { log } from '$lib/app/util/log'
import type { SiteStats } from '$lib/types/site-stats'

const CACHE_DURATION_MS = 5 * 60 * 1000 // 5 minutes

function isSiteStats(value: unknown): value is SiteStats {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return ['communities', 'subscribers', 'members', 'posts'].every(
    (key) => typeof record[key] === 'number',
  )
}

class SiteStatsState {
  private _data: SiteStats | undefined = $state(undefined)
  private _loading = $state(false)
  private _error: string | undefined = $state(undefined)
  private lastFetchedAt = 0

  get data(): SiteStats | undefined {
    return this._data
  }
  get loading(): boolean {
    return this._loading
  }
  get error(): string | undefined {
    return this._error
  }

  async fetch(): Promise<void> {
    if (!browser) return
    if (this._loading) return

    const now = Date.now()
    if (this._data && now - this.lastFetchedAt < CACHE_DURATION_MS) return

    this._loading = true
    this._error = undefined
    try {
      // The server sums the community list once for every visitor (see
      // $lib/server/site-stats) and the response is HTTP-cacheable.
      const res = await fetch('/api/site-stats')
      if (!res.ok) throw new Error(`site stats: HTTP ${res.status}`)
      const body: unknown = await res.json()
      if (!isSiteStats(body)) throw new Error('site stats: malformed response')
      this._data = body
      this.lastFetchedAt = now
    } catch (e) {
      this._error =
        e instanceof Error ? e.message : 'Failed to fetch site stats'
      log.error('Failed to fetch site stats', e)
    } finally {
      this._loading = false
    }
  }
}

export const siteStats = new SiteStatsState()
