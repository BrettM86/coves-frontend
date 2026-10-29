/**
 * Global setup for the SSR acceptance tier.
 *
 * Builds the app with adapter-node, boots a mock upstream and `node build`
 * against it, and hands the base URL to the tests. Everything runs once for
 * the whole tier: these tests are about what ONE Node process does when many
 * requests are in flight at the same time, so they must share a server.
 */
import type { TestProject } from 'vitest/node'
import { run, startBuiltServer, type BuiltServer } from './built-server'
import { startMockUpstream, type MockUpstream } from './mock-upstream'

declare module 'vitest' {
  interface ProvidedContext {
    ssrBaseUrl: string
    /** The mock upstream's origin, for reading its XRPC request log. */
    mockUpstreamUrl: string
  }
}

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  await run('pnpm', ['build'], { ...process.env, ADAPTER: 'node' })

  let upstream: MockUpstream | undefined
  let server: BuiltServer | undefined

  const teardown = async (): Promise<void> => {
    server?.stop()
    await upstream?.close()
  }

  try {
    upstream = await startMockUpstream()
    server = await startBuiltServer({ upstreamUrl: upstream.url })
    const { baseUrl } = server

    // One warm-up render, checked here rather than in the tests. A page that
    // grows a new upstream call would otherwise reach the suite as a 500 and
    // read as a behavioural failure; this reports the missing route by name.
    const warmup = await fetch(`${baseUrl}/`)
    await warmup.text()
    if (warmup.status !== 200 || upstream.unknownPaths.length > 0) {
      throw new Error(
        `warm-up GET / returned ${warmup.status}; ` +
          `unmocked upstream paths: ${JSON.stringify(upstream.unknownPaths)}\n${server.log()}`,
      )
    }

    project.provide('ssrBaseUrl', baseUrl)
    project.provide('mockUpstreamUrl', upstream.url)
  } catch (error) {
    await teardown()
    throw error
  }

  return teardown
}
