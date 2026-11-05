/**
 * Process helpers for the SSR acceptance tier: running the build, finding a
 * free port and booting `node build` against a mock upstream. Shared by
 * global-setup.ts (the tier's one long-lived server) and test files that need
 * a server of their own with a different environment.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)

/** How long the built server gets to accept its first connection. */
const READY_TIMEOUT_MS = 30_000
const READY_POLL_MS = 100

export function run(
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

export async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as net.AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/** Bounded poll: resolves as soon as the port accepts a TCP connection. */
export async function waitForPort(
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

export interface BuiltServerOptions {
  /** Origin of the mock upstream the server proxies and loads from. */
  readonly upstreamUrl: string
  /** Extra variables, applied after the standard ones. */
  readonly env?: Readonly<Record<string, string>>
  /** Variables removed from the inherited environment before booting. */
  readonly omitEnv?: readonly string[]
}

export interface BuiltServer {
  readonly baseUrl: string
  /** Everything the server has written to stdout and stderr so far. */
  log(): string
  stop(): void
}

/** Boots `node build` (the adapter-node output) and waits until it listens. */
export async function startBuiltServer(
  options: BuiltServerOptions,
): Promise<BuiltServer> {
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`

  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const name of options.omitEnv ?? []) delete env[name]

  let serverLog = ''
  const child = spawn('node', ['build'], {
    cwd: REPO_ROOT,
    env: {
      ...env,
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
      PUBLIC_INTERNAL_INSTANCE: options.upstreamUrl,
      ALLOW_HTTP_INTERNAL_INSTANCE: 'true',
      ...options.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk: Buffer) => (serverLog += chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => (serverLog += chunk.toString()))

  const stop = (): void => {
    child.kill('SIGKILL')
  }

  try {
    await waitForPort(port, child, () => serverLog)
  } catch (error) {
    stop()
    throw error
  }

  return { baseUrl, log: () => serverLog, stop }
}
