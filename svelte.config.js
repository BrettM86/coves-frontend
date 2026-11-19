import auto from '@sveltejs/adapter-auto'
import node from '@sveltejs/adapter-node'
import staticAdapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// src/hooks.server.ts inlines this file into <head> as a bare <script>; its
// hash in `script-src` admits it next to Kit's per-request nonce, and in an
// `ADAPTER=static` build, where a nonce placeholder would fail prerendering.
/** @type {`sha256-${string}`} */
const themeBootHash = `sha256-${createHash('sha256')
  .update(readFileSync('src/lib/app/state/theme/theme-boot.js'))
  .digest('base64')}`

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://kit.svelte.dev/docs/integrations#preprocessors
  // for more information about preprocessors
  preprocess: vitePreprocess(),

  kit: {
    // adapter-auto only supports some environments, see https://kit.svelte.dev/docs/adapter-auto for a list.
    // If your environment is not supported or you settled on a specific environment, switch out the adapter.
    // See https://kit.svelte.dev/docs/adapters for more information about adapters.
    adapter:
      process.env.ADAPTER == 'static'
        ? staticAdapter({
            fallback: 'app.html',
            precompress: true,
          })
        : process.env.ADAPTER == 'node'
          ? node()
          : auto(),
    // Lets an open tab notice a new deploy; the root layout then loads the
    // next link click in full so the tab moves onto the new build.
    version: {
      pollInterval: 60_000,
    },
    csp: {
      // Kit must own `script-src` to append its per-request nonce. The other
      // three are here only so an `ADAPTER=static` build (no server hooks)
      // keeps them; `$lib/server/security-headers` re-emits identical values
      // and owns every remaining directive at runtime.
      directives: {
        'script-src': ['self', themeBootHash],
        // Handler attributes only. `unsafe-hashes` + sha256 admit one inline
        // handler body: Svelte's SSR event-replay stub `this.__e=event`,
        // stamped on every element with an onload/onerror handler. Nonces
        // cannot cover handler attributes, and without this the stub is
        // refused and image error fallbacks never fire for anything that
        // fails before hydration. Kept out of `script-src` so the exception
        // never reaches script elements or Kit's generated script hashes.
        // `src/lib/server/ssr-event-replay.test.ts` pins the hash to the
        // string Svelte actually emits.
        'script-src-attr': [
          'unsafe-hashes',
          'sha256-7dQwUgLau1NFCCGjfn9FsYptB6ZtWxJin6VohGIu20I=',
        ],
        'base-uri': ['self'],
        'object-src': ['none'],
        'frame-ancestors': ['none'],
      },
    },
  },
}

export default config
