import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stateDirectory = join(frontend, '.dev-seed')
const filenames = ['manifest.json', 'oauth-test-account.json']

class ChildFailure extends Error {
  constructor(status) {
    super('QA child failed')
    this.status = status
  }
}

function localOrigin(value) {
  if (
    typeof value !== 'string' ||
    value.includes('\\') ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0)
      return code <= 0x20 || code === 0x7f
    })
  )
    throw new Error('Invalid local origin')
  const url = new URL(value)
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Invalid local origin')
  return url
}

function configuration() {
  const host = process.env.QA_BACKEND_HOST
  const checkout = process.env.QA_BACKEND_CHECKOUT
  if (
    typeof host !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(host) ||
    typeof checkout !== 'string' ||
    !checkout.startsWith('/') ||
    checkout.includes('\0')
  )
    throw new Error('Invalid backend configuration')
  return {
    host,
    checkout,
    web: localOrigin(process.env.OAUTH_WEB_BASE_URL ?? 'http://127.0.0.1:8080'),
    provider: localOrigin(process.env.PDS_URL),
  }
}

// Remote SSH commands are parsed by the remote shell even with shell:false.
function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

function metadata(path) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

function checkStatePaths() {
  const directory = metadata(stateDirectory)
  if (directory && (!directory.isDirectory() || directory.isSymbolicLink()))
    throw new Error('Unsafe private directory')
  for (const filename of filenames) {
    const file = metadata(join(stateDirectory, filename))
    if (file && (!file.isFile() || file.isSymbolicLink()))
      throw new Error('Unsafe private file')
  }
}

function child(command, arguments_, stage, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: frontend,
    env: process.env,
    shell: false,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  })
  const status = result.error || result.signal ? 1 : (result.status ?? 1)
  if (status !== 0) {
    // Child streams may contain credentials, provider URLs or fixture JSON.
    process.stderr.write(
      `QA ${stage} failed (exit ${status}); details withheld.\n`,
    )
    throw new ChildFailure(status)
  }
  return result.stdout
}

function validateState(manifest, account, provider) {
  if (manifest?.version !== 1 || !manifest.accounts?.mari)
    throw new Error('Invalid manifest')
  const manifestProvider = localOrigin(manifest.pds)
  const aliases = new Set(['localhost', '127.0.0.1'])
  if (
    manifestProvider.protocol !== provider.protocol ||
    manifestProvider.port !== provider.port ||
    !(
      manifestProvider.hostname === provider.hostname ||
      (aliases.has(manifestProvider.hostname) && aliases.has(provider.hostname))
    )
  )
    throw new Error('Mismatched provider')
  for (const field of ['handle', 'password', 'did']) {
    if (
      typeof account?.[field] !== 'string' ||
      account[field].trim().length === 0 ||
      account[field] !== manifest.accounts.mari[field]
    )
      throw new Error('Invalid or mismatched account')
  }
}

function main() {
  let staging
  process.umask(0o077)
  try {
    const config = configuration()
    checkStatePaths()
    if (!metadata(stateDirectory)) mkdirSync(stateDirectory, { mode: 0o700 })
    chmodSync(stateDirectory, 0o700)
    for (const filename of filenames) {
      const path = join(stateDirectory, filename)
      if (metadata(path)) chmodSync(path, 0o600)
    }
    const remote = (command, stage) =>
      child('ssh', ['--', config.host, command], stage)
    remote(
      `cd -- ${shellQuote(config.checkout)} && make dev-seed-restore`,
      'restore',
    )
    const remoteState = config.checkout.replace(/\/+$/, '') + '/.dev-seed/'
    const manifestBytes = remote(
      `cat -- ${shellQuote(remoteState + filenames[0])}`,
      'manifest fetch',
    )
    const accountBytes = remote(
      `cat -- ${shellQuote(remoteState + filenames[1])}`,
      'account fetch',
    )
    try {
      validateState(
        JSON.parse(manifestBytes),
        JSON.parse(accountBytes),
        config.provider,
      )
    } catch {
      process.stderr.write('QA state validation failed; details withheld.\n')
      return 1
    }
    staging = mkdtempSync(join(stateDirectory, '.qa-'))
    chmodSync(staging, 0o700)
    for (const [index, bytes] of [manifestBytes, accountBytes].entries()) {
      writeFileSync(join(staging, filenames[index]), bytes, {
        mode: 0o600,
        flag: 'wx',
      })
    }
    checkStatePaths()
    for (const filename of filenames) {
      renameSync(join(staging, filename), join(stateDirectory, filename))
    }
    rmSync(staging, { recursive: true })
    staging = undefined
    child('pnpm', ['test:oauth'], 'OAuth', {
      env: {
        ...process.env,
        OAUTH_TEST_ACCOUNT_FILE: join(stateDirectory, filenames[1]),
        OAUTH_WEB_BASE_URL: config.web.origin,
        PDS_URL: config.provider.origin,
        PLAYWRIGHT_NO_COPY_PROMPT: '1',
      },
    })
    process.stdout.write('QA OAuth completed.\n')
    return 0
  } catch (error) {
    if (error instanceof ChildFailure) return error.status
    process.stderr.write(
      'QA configuration or private-file operation failed; details withheld.\n',
    )
    return 1
  } finally {
    if (staging) {
      try {
        rmSync(staging, { recursive: true, force: true })
      } catch {
        process.stderr.write(
          'QA private staging cleanup failed; details withheld.\n',
        )
      }
    }
  }
}

process.exitCode = main()
