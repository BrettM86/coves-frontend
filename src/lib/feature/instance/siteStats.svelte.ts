import { browser } from '$app/environment'
import { coves } from '$lib/api/client.svelte'

export interface AggregatedStats {
  readonly communities: number
  readonly subscribers: number
  readonly members: number
  readonly posts: number
}

const CACHE_DURATION_MS = 5 * 60 * 1000 // 5 minutes

class SiteStats {
  private _data: AggregatedStats | undefined = $state(undefined)
  private _loading = $state(false)
  private _error: string | undefined = $state(undefined)
  private lastFetchedAt = 0

  get data(): AggregatedStats | undefined {
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
      const client = coves()
      // Fetch a large batch to get a reasonable aggregate
      const res = await client.listCommunities({ limit: 500 })
      const communities = res.communities

      this._data = {
        communities: communities.length,
        subscribers: communities.reduce((sum, c) => sum + c.subscriberCount, 0),
        members: communities.reduce((sum, c) => sum + c.memberCount, 0),
        posts: communities.reduce((sum, c) => sum + c.postCount, 0),
      }
      this.lastFetchedAt = now
    } catch (e) {
      this._error =
        e instanceof Error ? e.message : 'Failed to fetch site stats'
      console.error('Failed to fetch site stats:', e)
    } finally {
      this._loading = false
    }
  }
}

export const siteStats = new SiteStats()
