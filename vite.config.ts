import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [sveltekit(), tailwindcss()],
  build: {
    // Deliberate: ship sourcemaps in production. The app is AGPL with public
    // source, so maps leak nothing sensitive, and they make prod stack traces
    // debuggable. Revisit if closed-source code is ever bundled.
    sourcemap: true,
  },
  define: {
    __VERSION__: JSON.stringify(process.env.npm_package_version),
  },
  server: {
    watch: {
      ignored: ['!**/node_modules/mono-svelte/**'],
    },
  },
})
