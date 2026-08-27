import { defineConfig } from 'vitest/config'
import { sveltekit } from '@sveltejs/kit/vite'

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Restore spies automatically after every test. Without this, a test that
    // fails before its inline `mockRestore()` leaves the spy attached and its
    // recorded calls leak into the next test — which reads as a phantom extra
    // console call rather than the real failure.
    restoreMocks: true,
  },
})
