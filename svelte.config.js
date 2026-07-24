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
      'mono-svelte': 'src/lib/ui/shared',
      'svelte-hero-icons': 'node_modules/@xylightdev/svelte-hero-icons',
      $comp: 'src/lib/components',
    },
    csp: {
      directives: {
        'script-src': ['self'],
        // No <base> tag hijacking of relative URLs
        'base-uri': ['self'],
        // No Flash/plugin embeds
        'object-src': ['none'],
        // No clickjacking via framing (also enforced by Caddy's X-Frame-Options)
        'frame-ancestors': ['none'],
      },
      // NOTE: in production behind Caddy, the Caddyfile's `header` directive
      // REPLACES this header site-wide — keep the two policies in sync
      // (see Caddyfile in the backend repo).
    },
  },
}

export default config
