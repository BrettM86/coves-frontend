/**
 * Global setup for the SSR acceptance tier.
 *
 * Builds the app with adapter-node, boots a mock upstream and `node build`
 * against it, and hands the base URL to the tests. Everything runs once for
 * the whole tier: these tests are about what ONE Node process does when many
 * requests are in flight at the same time, so they must share a server.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'
import { startMockUpstream, type MockUpstream } from './mock-upstream'

declare module 'vitest' {
  interface ProvidedContext {
    ssrBaseUrl: string
    /** The mock upstream's origin, for reading its XRPC request log. */
    mockUpstreamUrl: string
  }
}

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)

/** How long the built server gets to accept its first connection. */
const READY_TIMEOUT_MS = 30_000
const READY_POLL_MS = 100

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `\`${command} ${args.join(' ')}\` exited ${code}:\n${output}`,
            ),
          ),
    )
  })
}

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as net.AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/** Bounded poll: resolves as soon as the port accepts a TCP connection. */
async function waitForPort(
  port: number,
  child: ChildProcess,
  log: () => string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(
        `built server exited ${child.exitCode} before accepting connections:\n${log()}`,
      )
    }
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ port, host: '127.0.0.1' })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        resolve(false)
      })
    })
    if (connected) return
    if (Date.now() > deadline) {
      throw new Error(
        `built server did not accept connections within ${READY_TIMEOUT_MS}ms:\n${log()}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS))
  }
}

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  await run('pnpm', ['build'], { ...process.env, ADAPTER: 'node' })

  let upstream: MockUpstream | undefined
  let server: ChildProcess | undefined

  const teardown = async (): Promise<void> => {
    server?.kill('SIGKILL')
    await upstream?.close()
  }

  try {
    upstream = await startMockUpstream()
    const port = await freePort()
    const baseUrl = `http://127.0.0.1:${port}`

    let serverLog = ''
    server = spawn('node', ['build'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        // NODE_ENV=production so the built server behaves as it will in deploy
        // (adapter-node and Svelte's runtime read it). `$app/environment`'s `dev`
        // is fixed at build time and already false here, so this does NOT
        // decide the dev-only canonical-host redirect in hooks.server.ts.
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: String(port),
        ORIGIN: baseUrl,
        PUBLIC_SSR_ENABLED: 'true',
        PUBLIC_INSTANCE_URL: baseUrl,
        PUBLIC_INTERNAL_INSTANCE: upstream.url,
        ALLOW_HTTP_INTERNAL_INSTANCE: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    server.stdout?.on(
      'data',
      (chunk: Buffer) => (serverLog += chunk.toString()),
    )
    server.stderr?.on(
      'data',
      (chunk: Buffer) => (serverLog += chunk.toString()),
    )

    await waitForPort(port, server, () => serverLog)

    // One warm-up render, checked here rather than in the tests. A page that
    // grows a new upstream call would otherwise reach the suite as a 500 and
    // read as a behavioural failure; this reports the missing route by name.
    const warmup = await fetch(`${baseUrl}/`)
    await warmup.text()
    if (warmup.status !== 200 || upstream.unknownPaths.length > 0) {
      throw new Error(
        `warm-up GET / returned ${warmup.status}; ` +
          `unmocked upstream paths: ${JSON.stringify(upstream.unknownPaths)}\n${serverLog}`,
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
