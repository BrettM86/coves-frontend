/**
 * Request body size limits on the built node server.
 *
 * What only this tier can see: adapter-node enforces BODY_SIZE_LIMIT while it
 * reads the request, before any route code runs, and production sets that
 * limit in docker-compose.prod.yml. These tests boot their own servers so the
 * environment is exactly the one under test: one with no BODY_SIZE_LIMIT at
 * all (adapter-node's 512K default) and one with the production value.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { REPO_ROOT, startBuiltServer, type BuiltServer } from './built-server'
import {
  RECEIVED_BODIES_PATH,
  XRPC_LOG_PATH,
  startMockUpstream,
  type MockUpstream,
  type ReceivedBody,
  type XrpcRequest,
} from './mock-upstream'

const UPLOAD_PATH = '/xrpc/social.coves.media.uploadImage'
const UPDATE_PROFILE_PATH = '/xrpc/social.coves.actor.updateProfile'

/**
 * Deterministic, non-repeating-at-a-glance bytes, so a truncated, padded or
 * re-encoded body cannot hash the same as the original.
 */
function patternedBytes(length: number, seed: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length)
  for (let index = 0; index < length; index++) {
    bytes[index] = (index * 31 + seed) % 251
  }
  return bytes
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** A 9,900,000-byte image, under the 10,000,000-byte upload cap. */
const uploadBytes = patternedBytes(9_900_000, 7)

/**
 * The updateProfile input the settings form sends for a 999,000-byte avatar:
 * the file's bytes base64-encoded into `avatarBlob`, as profile-form.ts does.
 */
const avatarInput = {
  displayName: 'Size Limit Tester',
  description: 'Uploading an avatar just under the 1,000,000-byte form cap.',
  avatarBlob: Buffer.from(patternedBytes(999_000, 13)).toString('base64'),
  avatarMimeType: 'image/jpeg',
}
const avatarJson = JSON.stringify(avatarInput)

/**
 * The `environment:` map of the frontend service in docker-compose.prod.yml.
 * A line-based read of the one block it needs, so the tier takes no YAML
 * dependency; it accepts both the map form and the `- KEY=value` list form.
 */
function productionFrontendEnvironment(): Record<string, string> {
  const lines = readFileSync(
    path.join(REPO_ROOT, 'docker-compose.prod.yml'),
    'utf8',
  ).split('\n')
  const indentOf = (line: string) => line.length - line.trimStart().length
  const isContent = (line: string) =>
    line.trim() !== '' && !line.trim().startsWith('#')

  const serviceIndex = lines.findIndex((line) =>
    /^ {2}frontend:\s*$/.test(line),
  )
  expect(serviceIndex).toBeGreaterThanOrEqual(0)

  const environment: Record<string, string> = {}
  let environmentIndent: number | null = null
  for (const line of lines.slice(serviceIndex + 1)) {
    if (!isContent(line)) continue
    if (indentOf(line) <= 2) break
    if (environmentIndent === null) {
      if (/^\s+environment:\s*$/.test(line)) environmentIndent = indentOf(line)
      continue
    }
    if (indentOf(line) <= environmentIndent) break
    const entry = line
      .trim()
      .replace(/^-\s*/, '')
      .match(/^([A-Z0-9_]+)\s*[:=]\s*(.*)$/)
    if (entry === null) continue
    const [, name, rawValue] = entry
    if (name === undefined || rawValue === undefined) continue
    environment[name] = rawValue.trim().replace(/^(["'])(.*)\1$/, '$2')
  }
  return environment
}

let upstream: MockUpstream | undefined
let defaultLimitServer: BuiltServer | undefined
let productionLimitServer: BuiltServer | undefined

function running<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} did not start`)
  return value
}

beforeAll(async () => {
  upstream = await startMockUpstream()
  defaultLimitServer = await startBuiltServer({
    upstreamUrl: upstream.url,
    omitEnv: ['BODY_SIZE_LIMIT'],
  })
})

afterAll(async () => {
  defaultLimitServer?.stop()
  productionLimitServer?.stop()
  await upstream?.close()
})

beforeEach(async () => {
  const { url } = running(upstream, 'mock upstream')
  await fetch(`${url}${XRPC_LOG_PATH}`, { method: 'DELETE' })
  await fetch(`${url}${RECEIVED_BODIES_PATH}`, { method: 'DELETE' })
})

async function upstreamPaths(): Promise<string[]> {
  const { url } = running(upstream, 'mock upstream')
  const response = await fetch(`${url}${XRPC_LOG_PATH}`)
  expect(response.status).toBe(200)
  return ((await response.json()) as { requests: XrpcRequest[] }).requests.map(
    (request) => request.path,
  )
}

async function receivedBodies(): Promise<ReceivedBody[]> {
  const { url } = running(upstream, 'mock upstream')
  const response = await fetch(`${url}${RECEIVED_BODIES_PATH}`)
  expect(response.status).toBe(200)
  return ((await response.json()) as { bodies: ReceivedBody[] }).bodies
}

/** A same-origin POST through the app's API proxy, as the browser sends it. */
async function proxyPost(
  server: BuiltServer,
  upstreamPath: string,
  body: Uint8Array<ArrayBuffer> | string,
  contentType: string,
): Promise<number> {
  const response = await fetch(`${server.baseUrl}/api/proxy${upstreamPath}`, {
    method: 'POST',
    headers: {
      Origin: server.baseUrl,
      'Content-Type': contentType,
      Cookie: 'coves_session=a',
    },
    body,
  })
  await response.arrayBuffer()
  return response.status
}

describe('without BODY_SIZE_LIMIT (adapter-node default)', () => {
  it('rejects a 999,000-byte avatar update with 413 and never calls upstream', async () => {
    const server = running(defaultLimitServer, 'default-limit server')

    const status = await proxyPost(
      server,
      UPDATE_PROFILE_PATH,
      avatarJson,
      'application/json',
    )

    expect(status).toBe(413)
    expect(await upstreamPaths()).not.toContain(UPDATE_PROFILE_PATH)
  })

  it('rejects a 9,900,000-byte image upload with 413 and never calls upstream', async () => {
    const server = running(defaultLimitServer, 'default-limit server')

    const status = await proxyPost(
      server,
      UPLOAD_PATH,
      uploadBytes,
      'image/jpeg',
    )

    expect(status).toBe(413)
    expect(await upstreamPaths()).not.toContain(UPLOAD_PATH)
  })
})

describe('with the production BODY_SIZE_LIMIT', () => {
  beforeAll(async () => {
    const bodySizeLimit = productionFrontendEnvironment().BODY_SIZE_LIMIT
    expect(bodySizeLimit).toBe('10500000')
    productionLimitServer = await startBuiltServer({
      upstreamUrl: running(upstream, 'mock upstream').url,
      env: { BODY_SIZE_LIMIT: '10500000' },
    })
  })

  it('forwards a 9,900,000-byte image upload byte for byte', async () => {
    const server = running(productionLimitServer, 'production-limit server')

    const status = await proxyPost(
      server,
      UPLOAD_PATH,
      uploadBytes,
      'image/jpeg',
    )

    expect(status).toBe(200)
    const uploads = (await receivedBodies()).filter(
      (body) => body.path === UPLOAD_PATH,
    )
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatchObject({
      contentType: 'image/jpeg',
      size: 9_900_000,
      sha256: sha256(uploadBytes),
    })
  })

  it('forwards a 999,000-byte avatar update intact', async () => {
    const server = running(productionLimitServer, 'production-limit server')

    const status = await proxyPost(
      server,
      UPDATE_PROFILE_PATH,
      avatarJson,
      'application/json',
    )

    expect(status).toBe(200)
    const updates = (await receivedBodies()).filter(
      (body) => body.path === UPDATE_PROFILE_PATH,
    )
    expect(updates).toHaveLength(1)
    expect(updates[0]?.sha256).toBe(sha256(avatarJson))
    expect(updates[0]?.json).toEqual(avatarInput)
  })
})
