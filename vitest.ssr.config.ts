import { defineConfig } from 'vitest/config'

/**
 * The SSR acceptance tier: black-box HTTP against a real `ADAPTER=node` build.
 *
 * Deliberately without the sveltekit plugin — nothing under `tests/ssr` imports
 * app source, and the plugin would try to run Kit's dev pipeline around a suite
 * whose whole point is the built artifact. The root `vitest.config.ts` only
 * includes `src/**`, so this tier never runs as part of `pnpm test`.
 */
export default defineConfig({
  test: {
    include: ['tests/ssr/**/*.test.ts'],
    environment: 'node',
    globalSetup: 'tests/ssr/global-setup.ts',
    // Build + boot happen in globalSetup; each test then fires 40-100 renders.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One shared server and one shared upstream request log, so two files
    // running at once would interleave their traffic into each other's
    // assertions.
    fileParallelism: false,
  },
})
