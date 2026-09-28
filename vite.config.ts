import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [sveltekit(), tailwindcss()],
  build: {
    // Deliberate: ship sourcemaps in production. The app is AGPL with public
    // source, so maps leak nothing sensitive, and they make prod stack traces
    // debuggable. Revisit if closed-source code is ever bundled.
    sourcemap: true,
    // Browser bundle only. Left to itself, Rolldown scatters the Svelte and
    // Kit runtimes across a dozen sub-kilobyte chunks, each its own request,
    // although every route loads all of them. One group puts them in a single
    // chunk: fewer requests and better compression on every route. Wider
    // grouping (entries-aware catch-alls, merging small app modules) was
    // measured and rejected: it cut requests but made every route download
    // tens of kB of code it does not use.
    rolldownOptions: isSsrBuild
      ? undefined
      : {
          output: {
            codeSplitting: {
              groups: [
                {
                  name: 'framework',
                  test: /node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:svelte|@sveltejs[\\/]kit|devalue|clsx|esm-env)[\\/]/,
                },
              ],
            },
          },
        },
  },
  define: {
    __VERSION__: JSON.stringify(process.env.npm_package_version),
  },
}))
