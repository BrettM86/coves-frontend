/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker'

// Create a unique cache name for this deployment
const CACHE = `cache-${version}`

const ASSETS = [
  ...build, // the app itself
  ...files, // everything in `static`
]

self.addEventListener('install', (event) => {
  console.info('[i] Installing service worker')
  // Create a new cache and add all files to it
  async function addFilesToCache() {
    const cache = await caches.open(CACHE)
    try {
      await cache.addAll(ASSETS)
    } catch (err) {
      // `addAll` is all-or-nothing, so this leaves nothing usable behind. The
      // throw is the point — it fails the install so the browser discards this
      // worker instead of activating one with a half-filled precache — but a
      // bare rejection surfaces nowhere, and this is the failure that explains
      // a deploy where every asset silently misses.
      console.error('[sw] precache failed', {
        cache: CACHE,
        count: ASSETS.length,
        err,
      })
      throw err
    }
  }

  event.waitUntil(addFilesToCache())
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
  if (!ASSETS.includes(url.pathname)) return

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
