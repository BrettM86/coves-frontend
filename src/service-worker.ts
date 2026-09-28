/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { base, build, files, version } from '$service-worker'

// Bump when a shipped build may have let a script write into the cache (an
// XSS fix, say). Files are only carried over from caches of the same epoch, so
// a bump makes every returning visitor download the whole app again.
const SECURITY_EPOCH = 1
const CACHE_PREFIX = `cache-e${SECURITY_EPOCH}-`

// Create a unique cache name for this deployment
const CACHE = `${CACHE_PREFIX}${version}`

const ASSETS = [
  ...build, // the app itself
  ...files, // everything in `static`
]
const ASSET_SET = new Set(ASSETS)

// Vite content-hashes everything under `_app/immutable`, so a path there names
// the same bytes in every deployment that has it. `static/` files keep their
// names across changes and are always fetched fresh.
const IMMUTABLE = new Set(
  build.filter((path) => path.includes('/_app/immutable/')),
)

/**
 * Copies into `cache` every immutable asset an earlier deployment's cache
 * already holds, and returns the assets still to download. `version` changes
 * on every deploy, so without this each deploy made every returning visitor
 * re-download the whole app, including the files that did not change.
 *
 * Only immutable paths are carried over: an old cache may still hold a page
 * the leaking runtime cache stored, and that must never cross into this one.
 * Only successful same-origin responses are, and only from caches of this
 * security epoch. A lookup that fails just counts as a miss.
 */
async function reusePreviousAssets(cache: Cache): Promise<string[]> {
  const previous: Cache[] = []
  try {
    for (const key of await caches.keys()) {
      if (key !== CACHE && key.startsWith(CACHE_PREFIX)) {
        previous.push(await caches.open(key))
      }
    }
  } catch (err) {
    console.warn('[sw] could not read previous caches', err)
  }

  const missing = await Promise.all(
    ASSETS.map(async (asset) => {
      if (!IMMUTABLE.has(asset)) return asset
      try {
        for (const old of previous) {
          const hit = await old.match(asset)
          if (hit?.ok && hit.type === 'basic') {
            await cache.put(asset, hit)
            return null
          }
        }
      } catch (err) {
        // Fall through to the network.
        console.warn('[sw] could not reuse cached asset', asset, err)
      }
      return asset
    }),
  )
  return missing.filter((asset) => asset !== null)
}

/**
 * Chromium's static routing (`InstallEvent.addRoutes`): requests this worker
 * only ever declines go to the network without starting the worker at all.
 * Otherwise every page load and data request first waited for a possibly
 * cold worker, just to be told no. The rules restate what the fetch handler
 * below declines; browsers without the API keep using the handler.
 */
interface RoutingInstallEvent extends ExtendableEvent {
  addRoutes?: (rules: readonly object[]) => Promise<void>
}

function networkOnlyRoutes(): object[] {
  const rules: object[] = [
    { condition: { requestMode: 'navigate' }, source: 'network' },
  ]
  if (typeof URLPattern === 'function') {
    for (const pathname of [`${base}/api/*`, '*/__data.json']) {
      rules.push({
        condition: { urlPattern: new URLPattern({ pathname }) },
        source: 'network',
      })
    }
  }
  return rules
}

self.addEventListener('install', (event) => {
  console.info('[i] Installing service worker')

  // Create a new cache and add all files to it
  async function addFilesToCache() {
    const cache = await caches.open(CACHE)
    const missing = await reusePreviousAssets(cache)
    try {
      await cache.addAll(missing)
    } catch (err) {
      // `addAll` is all-or-nothing, so none of the missing assets were added;
      // only the ones reused from earlier caches are in this one. The throw is
      // the point — it fails the install so the browser discards this worker
      // instead of activating one with a half-filled precache — but a bare
      // rejection surfaces nowhere, and this is the failure that explains a
      // deploy where every asset silently misses.
      console.error('[sw] precache failed', {
        cache: CACHE,
        requested: missing.length,
        reused: ASSETS.length - missing.length,
        err,
      })
      throw err
    }
  }

  event.waitUntil(addFilesToCache())

  // Registered after the precache, and guarded, so that nothing going wrong
  // here — `new URLPattern` throwing, say — can keep the precache from running.
  try {
    const routing = event as RoutingInstallEvent
    if (typeof routing.addRoutes === 'function') {
      // Best effort: an older implementation that rejects a rule must not fail
      // the install, which the handler covers either way.
      event.waitUntil(
        routing
          .addRoutes(networkOnlyRoutes())
          .catch((err: unknown) =>
            console.warn('[sw] static routes not registered', err),
          ),
      )
    }
  } catch (err) {
    console.warn('[sw] static routes not registered', err)
  }

  // Skip the wait: the previous worker is the leaking one, and every moment it
  // stays in control is a moment it can replay its runtime cache. The usual
  // objection — an open page asking the new worker for chunks the old build
  // named, which it does not have — does not apply here, because anything
  // outside ASSETS is declined to the network rather than answered from cache.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  console.info('[i] Activating service worker')
  // Remove previous cached data from disk
  async function deleteOldCaches() {
    for (const key of await caches.keys()) {
      if (key === CACHE) continue

      try {
        await caches.delete(key)
      } catch (err) {
        // One undeletable cache must not abort the purge or the claim; the
        // rest still go, and nothing is served from them either way.
        console.warn('[sw] could not delete old cache', key, err)
      }
    }
  }

  // Claim strictly after the purge. Claiming first would put the already-open
  // tabs under a worker whose old caches are still on disk; ordering it this
  // way means the moment they are ours, the previous deployment's stored pages
  // are already gone. Without the claim they keep talking to the leaking
  // worker until every last tab is closed.
  event.waitUntil(deleteOldCaches().then(() => self.clients.claim()))
})

self.addEventListener('fetch', (e) => {
  const event = e as FetchEvent
  // ignore POST requests etc
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)

  // Cross-origin resources (image proxy host, PDS video) are left to the
  // browser. Intercepting them would re-issue the fetch under the policy on
  // this script — which is whatever the edge served it with, not the page's
  // CSP — and the service worker has no business caching them anyway.
  if (url.origin !== self.location.origin) return

  // The precached assets are the only thing this worker answers. Everything
  // else on this origin is a document, a `__data.json`, an /api/ call, or one
  // of Kit's own `/_app/version.json` and `env.js` — either session-bearing or
  // not worth storing. A stored copy of the session-bearing ones, replayed
  // offline, hands the previous user's session to the next person on the
  // device. That replay was the leak; the fix is to store none of it. Nothing
  // legitimate is lost: `build` is content-hashed and `static/` is copied into
  // `files`, so both are already precached by `install`.
  //
  // Declining (returning without `respondWith`) rather than proxying leaves the
  // request exactly as the browser would have made it — same credentials, same
  // redirect and cache semantics — instead of re-issuing it from here.
  if (!ASSET_SET.has(url.pathname)) return

  event.respondWith(
    (async () => {
      try {
        // Matched by pathname, which is how `install` keyed them. A miss means
        // the browser evicted the precache under storage pressure — a failed
        // install discards the worker outright, so it can never be a partial
        // one.
        const cache = await caches.open(CACHE)
        const cached = await cache.match(url.pathname)

        if (cached) return cached
      } catch (err) {
        // Private browsing and some enterprise policies reject `caches.open`
        // outright. `respondWith` has already committed us to answering, so an
        // unhandled rejection here is a broken page rather than a degraded one.
        // Only the lookup is guarded: a network failure below is the browser's
        // own error to report, exactly as it would be without this worker.
        console.warn(
          '[sw] precache lookup failed, falling back to network',
          url.pathname,
          err,
        )
      }

      return fetch(event.request)
    })(),
  )
})
