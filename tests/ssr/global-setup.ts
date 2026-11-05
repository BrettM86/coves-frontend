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
    /**
     * A second built server, same build and upstream, with a valid
     * PUBLIC_THEME. The main server runs with PUBLIC_THEME removed.
     */
    ssrInstanceThemeBaseUrl: string
  }
}

/** The PUBLIC_THEME the second server runs with: valid, legacy colours-only. */
const INSTANCE_THEME = JSON.stringify({ zinc: { '950': '0 0 0' } })

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  await run('pnpm', ['build'], { ...process.env, ADAPTER: 'node' })

  let upstream: MockUpstream | undefined
  const servers: BuiltServer[] = []

  const teardown = async (): Promise<void> => {
    for (const server of servers) server.stop()
    await upstream?.close()
  }

  try {
    upstream = await startMockUpstream()
    const main = await startBuiltServer({
      upstreamUrl: upstream.url,
      omitEnv: ['PUBLIC_THEME'],
    })
    servers.push(main)
    const themed = await startBuiltServer({
      upstreamUrl: upstream.url,
      env: { PUBLIC_THEME: INSTANCE_THEME },
    })
    servers.push(themed)
    const baseUrl = main.baseUrl

    // One warm-up render, checked here rather than in the tests. A page that
    // grows a new upstream call would otherwise reach the suite as a 500 and
    // read as a behavioural failure; this reports the missing route by name.
    const warmup = await fetch(`${baseUrl}/`)
    await warmup.text()
    if (warmup.status !== 200 || upstream.unknownPaths.length > 0) {
      throw new Error(
        `warm-up GET / returned ${warmup.status}; ` +
          `unmocked upstream paths: ${JSON.stringify(upstream.unknownPaths)}\n${main.log()}`,
      )
    }

    project.provide('ssrBaseUrl', baseUrl)
    project.provide('mockUpstreamUrl', upstream.url)
    project.provide('ssrInstanceThemeBaseUrl', themed.baseUrl)
  } catch (error) {
    await teardown()
    throw error
  }

  return teardown
}
