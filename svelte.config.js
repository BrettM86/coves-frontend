import auto from '@sveltejs/adapter-auto'
import node from '@sveltejs/adapter-node'
import staticAdapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

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
    alias: {
      'svelte-hero-icons': 'node_modules/@xylightdev/svelte-hero-icons',
    },
    csp: {
      // Kit must own `script-src` to append its per-request nonce. The other
      // three are here only so an `ADAPTER=static` build (no server hooks)
      // keeps them; `$lib/server/security-headers` re-emits identical values
      // and owns every remaining directive at runtime.
      directives: {
        'script-src': ['self'],
        'base-uri': ['self'],
        'object-src': ['none'],
        'frame-ancestors': ['none'],
      },
    },
  },
}

export default config
