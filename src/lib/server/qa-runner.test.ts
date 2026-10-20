import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const temporaryDirectories: string[] = []
const privateMarkers = [
  'qaidentity',
  'qapassword',
  'qatoken',
  'qacookie',
  'qacallback',
  'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa',
]
const callback = 'http://127.0.0.1:8080/oauth/callback?code=qacallback'

type Account = {
  handle?: unknown
  password?: unknown
  did?: unknown
  [key: string]: unknown
}
type Seed = {
  version: number
  seededAt: string
  seedHash: string
  appview: string
  pds: string
  accounts: Record<string, Account>
  communities: Record<string, unknown>
  posts: Record<string, unknown>
  comments: Record<string, unknown>
}
type State = { account: Account; manifest: Seed }
type Event = {
  action: string
  arguments?: string[]
  checkoutMatches?: boolean
  oldLocalComplete?: boolean
}
type OAuthObservation = {
  arguments: string[]
  checkoutMatches: boolean
  accountPathMatches: boolean
  currentManifest: boolean
  currentAccount: boolean
  privateDirectory: boolean
  privateFiles: boolean
  replacedBothInodes: boolean
  webOrigin: string | undefined
  providerOrigin: string | undefined
  noCopyPrompt: string | undefined
}
type Harness = {
  root: string
  frontend: string
  backend: string
  caller: string
  stateDirectory: string
  controlPath: string
  eventsPath: string
  transportPath: string
  observationPath: string
  environment: NodeJS.ProcessEnv
  controls: Record<string, unknown>
  state: State
}

// One temporary Node program supplies the three subprocess boundaries. SSH
// executes the exact remote command through a real shell; cat reads real files.
// Credentials are synthetic and travel in private files, never command text.
const subprocessDouble = String.raw`#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const control = JSON.parse(fs.readFileSync(process.env.QA_CONTRACT_CONTROL, 'utf8'))
const arguments_ = process.argv.slice(2)
const action = path.basename(process.argv[1])
const record = (file, value) => fs.appendFileSync(file, JSON.stringify(value) + '\n')
const read = (file) => { try { return fs.readFileSync(file, 'utf8') } catch { return null } }
const metadata = (file) => { try { return fs.statSync(file) } catch { return null } }
const diagnostic = () => {
  const text = control.privateMarkers.join(' ') + ' ' + control.callback + ' RAW_QA_DIAGNOSTIC ' + 'x'.repeat(16384)
  process.stdout.write(text)
  process.stderr.write(text)
}
if (action === 'ssh') {
  record(control.transportPath, { arguments: arguments_ })
  if (arguments_.length !== 3 || arguments_[0] !== '--' || arguments_[1] !== control.backendHost) process.exit(91)
  const command = arguments_[2]
  const stage = command.includes('/.dev-seed/oauth-test-account.json') ? 'account-fetch'
    : command.includes('/.dev-seed/manifest.json') ? 'manifest-fetch' : 'restore'
  if (stage !== 'restore') {
    record(control.eventsPath, {
      action: stage,
      oldLocalComplete: read(control.localManifest) === control.priorManifest && read(control.localAccount) === control.priorAccount,
    })
    if (control.failStage === stage) { diagnostic(); process.exit(stage === 'manifest-fetch' ? 32 : 33) }
  }
  const result = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', maxBuffer: 1048576, env: process.env })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  process.exit(result.status === null ? 92 : result.status)
}
if (action === 'make') {
  record(control.eventsPath, { action: 'restore', arguments: arguments_, checkoutMatches: process.cwd() === control.backend })
  if (control.failStage === 'restore') { diagnostic(); process.exit(31) }
  fs.writeFileSync(path.join(process.cwd(), '.dev-seed/manifest.json'), control.nextManifest)
  fs.writeFileSync(path.join(process.cwd(), '.dev-seed/oauth-test-account.json'), control.nextAccount)
  diagnostic()
  process.exit(0)
}
if (action === 'pnpm') {
  record(control.eventsPath, { action: 'oauth' })
  const manifest = metadata(control.localManifest)
  const account = metadata(control.localAccount)
  const directory = metadata(path.dirname(control.localAccount))
  fs.writeFileSync(control.observationPath, JSON.stringify({
    arguments: arguments_,
    checkoutMatches: process.cwd() === control.frontend,
    accountPathMatches: process.env.OAUTH_TEST_ACCOUNT_FILE === control.localAccount,
    currentManifest: read(control.localManifest) === control.nextManifest,
    currentAccount: read(control.localAccount) === control.nextAccount,
    privateDirectory: directory !== null && (directory.mode & 511) === 448,
    privateFiles: manifest !== null && account !== null && (manifest.mode & 511) === 384 && (account.mode & 511) === 384,
    replacedBothInodes: manifest !== null && account !== null && manifest.ino !== control.priorManifestInode && account.ino !== control.priorAccountInode,
    webOrigin: process.env.OAUTH_WEB_BASE_URL,
    providerOrigin: process.env.PDS_URL,
    noCopyPrompt: process.env.PLAYWRIGHT_NO_COPY_PROMPT,
  }))
  diagnostic()
  process.exit(control.oauthExit || 0)
}
process.exit(93)
`

beforeAll(() => {
  const result = spawnSync(process.execPath, ['--check'], {
    input: subprocessDouble,
    encoding: 'utf8',
  })
  expect(result.status, 'the temporary subprocess double must parse').toBe(0)
})

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function privateFile(path: string, content: string) {
  writeFileSync(path, content, { mode: 0o600 })
  chmodSync(path, 0o600)
}

function createHarness(hostilePaths = false): Harness {
  // macOS tmpdir() is a symlink; child processes report the resolved cwd.
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'coves-web-qa-contract-')),
  )
  temporaryDirectories.push(root)
  const unusual = hostilePaths
    ? ' space \'";$(printf literal) `printf literal`\n'
    : ''
  const frontend = join(root, 'frontend' + unusual)
  const backend = join(root, 'backend' + unusual, 'coves')
  const caller = join(root, 'caller' + unusual)
  const binaryDirectory = join(root, 'bin')
  const stateDirectory = join(frontend, '.dev-seed')
  for (const directory of [
    join(frontend, 'scripts'),
    join(backend, '.dev-seed'),
    caller,
    binaryDirectory,
    stateDirectory,
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
  }
  copyFileSync(
    join(repository, 'scripts/qa-run.mjs'),
    join(frontend, 'scripts/qa-run.mjs'),
  )
  for (const name of ['ssh', 'make', 'pnpm']) {
    const file = join(binaryDirectory, name)
    writeFileSync(file, subprocessDouble, { mode: 0o700 })
    chmodSync(file, 0o700)
  }
  const account: Account = {
    handle: 'qaidentity.local.test',
    password: 'qapassword',
    did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa',
    privateDiagnostics: { token: 'qatoken', cookie: 'qacookie', callback },
  }
  const manifest: Seed = {
    version: 1,
    seededAt: '2026-10-15T00:00:00Z',
    seedHash: 'a'.repeat(64),
    appview: 'http://localhost:8081',
    pds: 'http://localhost:3001',
    accounts: { mari: { ...account } },
    communities: {},
    posts: {},
    comments: {},
  }
  const priorManifest = '{"generation":"stale-local-manifest"}\n'
  const priorAccount = '{"generation":"stale-local-account"}\n'
  const localManifest = join(stateDirectory, 'manifest.json')
  const localAccount = join(stateDirectory, 'oauth-test-account.json')
  writeFileSync(localManifest, priorManifest)
  writeFileSync(localAccount, priorAccount)
  // The runner must establish local privacy instead of inheriting permissive
  // modes from a previous copy or backend identity output.
  chmodSync(stateDirectory, 0o755)
  chmodSync(localManifest, 0o644)
  chmodSync(localAccount, 0o644)
  privateFile(
    join(backend, '.dev-seed/manifest.json'),
    '{"generation":"stale-remote-manifest"}\n',
  )
  privateFile(
    join(backend, '.dev-seed/oauth-test-account.json'),
    '{"generation":"stale-remote-account"}\n',
  )
  const eventsPath = join(root, 'events.jsonl')
  const transportPath = join(root, 'transport.jsonl')
  const observationPath = join(root, 'oauth-observation.json')
  // No-op RED must observe absence, never fail to read a missing log.
  privateFile(eventsPath, '')
  privateFile(transportPath, '')
  privateFile(observationPath, 'null\n')
  const controlPath = join(root, 'control.json')
  const controls = {
    frontend,
    backend,
    backendHost: hostilePaths ? 'qa-other' : 'qa-host',
    localManifest,
    localAccount,
    priorManifest,
    priorAccount,
    priorManifestInode: statSync(localManifest).ino,
    priorAccountInode: statSync(localAccount).ino,
    eventsPath,
    transportPath,
    observationPath,
    privateMarkers,
    callback,
    nextManifest: JSON.stringify(manifest),
    nextAccount: JSON.stringify(account),
  }
  privateFile(controlPath, JSON.stringify(controls))
  return {
    root,
    frontend,
    backend,
    caller,
    stateDirectory,
    controlPath,
    eventsPath,
    transportPath,
    observationPath,
    controls,
    state: { account, manifest },
    environment: {
      PATH: [
        binaryDirectory,
        dirname(process.execPath),
        '/usr/bin',
        '/bin',
      ].join(delimiter),
      HOME: root,
      LANG: 'C',
      QA_CONTRACT_CONTROL: controlPath,
      QA_BACKEND_HOST: hostilePaths ? 'qa-other' : 'qa-host',
      QA_BACKEND_CHECKOUT: backend,
      PDS_URL: 'http://localhost:3001',
      OAUTH_TEST_ACCOUNT_FILE: join(root, 'stale-account-override.json'),
    },
  }
}

function configure(harness: Harness, extra: Record<string, unknown> = {}) {
  Object.assign(
    harness.controls,
    {
      nextManifest: JSON.stringify(harness.state.manifest),
      nextAccount: JSON.stringify(harness.state.account),
    },
    extra,
  )
  privateFile(harness.controlPath, JSON.stringify(harness.controls))
}

function invoke(harness: Harness): SpawnSyncReturns<string> {
  const result = spawnSync(
    process.execPath,
    [join(harness.frontend, 'scripts/qa-run.mjs')],
    {
      cwd: harness.caller,
      env: harness.environment,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    },
  )
  expect(
    result.error === undefined && result.signal === null,
    'runner must terminate ordinarily, without setup or timeout failure',
  ).toBe(true)
  return result
}

function events(harness: Harness): Event[] {
  return readFileSync(harness.eventsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Event)
}

function transport(harness: Harness): { arguments: string[] }[] {
  return readFileSync(harness.transportPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { arguments: string[] })
}

function expectPrivateOutput(
  result: SpawnSyncReturns<string>,
  fixturePayloads: string[] = [],
) {
  const output = result.stdout + result.stderr
  expect
    .soft(
      output.length <= 2048,
      'combined diagnostics must stay within 2048 characters',
    )
    .toBe(true)
  for (const marker of [
    ...privateMarkers,
    callback,
    'RAW_QA_DIAGNOSTIC',
    ...fixturePayloads,
  ]) {
    expect
      .soft(
        output.includes(marker),
        'private marker or raw fixture/diagnostic must not appear in either stream',
      )
      .toBe(false)
  }
}

function expectNoBrowser(harness: Harness, result: SpawnSyncReturns<string>) {
  expect
    .soft(
      events(harness).some((event) => event.action === 'oauth'),
      'invalid or failed state must stop before OAuth',
    )
    .toBe(false)
  expect
    .soft(
      /\b(?:qa|oauth)\s+(?:completed|succeeded)\b/i.test(
        result.stdout + result.stderr,
      ),
      'failed invocation must not indicate QA success',
    )
    .toBe(false)
}

describe('web QA restore/private-fetch runner', () => {
  it.each([false, true])(
    'R1 restores exactly once and launches with current private state (hostile paths: %s)',
    (hostilePaths) => {
      const harness = createHarness(hostilePaths)
      if (hostilePaths) {
        harness.environment.OAUTH_WEB_BASE_URL = 'http://127.0.0.1:8098'
        harness.environment.PDS_URL = 'http://127.0.0.1:3001'
      }
      const result = invoke(harness)
      const history = events(harness)
      expect
        .soft(
          result.status,
          'successful QA must preserve the child success status',
        )
        .toBe(0)
      expect
        .soft(
          history.map((event) => event.action),
          'restore must precede both fetches and OAuth, exactly once',
        )
        .toEqual(['restore', 'manifest-fetch', 'account-fetch', 'oauth'])
      const restore = history.find((event) => event.action === 'restore')
      expect
        .soft(
          restore?.checkoutMatches,
          'restore must use the configured absolute checkout literally',
        )
        .toBe(true)
      expect
        .soft(restore?.arguments, 'restore must call the existing target')
        .toEqual(['dev-seed-restore'])
      expect
        .soft(
          history
            .filter((event) => event.action.endsWith('-fetch'))
            .map((event) => event.oldLocalComplete),
          'fetching must not truncate or partially replace prior local files',
        )
        .toEqual([true, true])
      const calls = transport(harness)
      expect
        .soft(calls.length, 'one restore and two fetch transports are required')
        .toBe(3)
      expect
        .soft(
          calls.every(
            (call) =>
              call.arguments.length === 3 &&
              call.arguments[0] === '--' &&
              call.arguments[1] === (hostilePaths ? 'qa-other' : 'qa-host'),
          ),
          'SSH host must remain a literal positional argument',
        )
        .toBe(true)
      const observed = JSON.parse(
        readFileSync(harness.observationPath, 'utf8'),
      ) as OAuthObservation | null
      expect
        .soft(
          observed?.arguments,
          'launch the existing OAuth tier with literal arguments',
        )
        .toEqual(['test:oauth'])
      for (const field of [
        'checkoutMatches',
        'accountPathMatches',
        'currentManifest',
        'currentAccount',
        'privateDirectory',
        'privateFiles',
        'replacedBothInodes',
      ] as const) {
        expect
          .soft(
            observed?.[field],
            'OAuth must observe the current complete private files in the reviewed frontend checkout',
          )
          .toBe(true)
      }
      expect
        .soft(observed?.webOrigin)
        .toBe(hostilePaths ? 'http://127.0.0.1:8098' : 'http://127.0.0.1:8080')
      expect
        .soft(observed?.providerOrigin)
        .toBe(hostilePaths ? 'http://127.0.0.1:3001' : 'http://localhost:3001')
      expect.soft(observed?.noCopyPrompt).toBe('1')
      expectPrivateOutput(result)
    },
  )

  it.each([
    { stage: 'restore', status: 31, history: ['restore'] },
    {
      stage: 'manifest-fetch',
      status: 32,
      history: ['restore', 'manifest-fetch'],
    },
    {
      stage: 'account-fetch',
      status: 33,
      history: ['restore', 'manifest-fetch', 'account-fetch'],
    },
  ])(
    'R2 fails fast with private bounded diagnostics at $stage',
    ({ stage, status, history }) => {
      const harness = createHarness()
      configure(harness, { failStage: stage })
      const result = invoke(harness)
      expect
        .soft(
          result.status,
          'propagate the reached restore/fetch failure status',
        )
        .toBe(status)
      expect
        .soft(
          events(harness).map((event) => event.action),
          'the failing stage must be reached with no later action',
        )
        .toEqual(history)
      expectNoBrowser(harness, result)
      expectPrivateOutput(result)
    },
  )

  const invalidStates: {
    name: string
    alter: (state: State) => void
    raw?: 'manifest' | 'account'
  }[] = [
    { name: 'malformed manifest JSON', alter: () => {}, raw: 'manifest' },
    { name: 'malformed account JSON', alter: () => {}, raw: 'account' },
    {
      name: 'missing manifest Mari',
      alter: ({ manifest }) => {
        delete manifest.accounts.mari
      },
    },
    {
      name: 'unsupported manifest version',
      alter: ({ manifest }) => {
        manifest.version = 2
      },
    },
    ...(['handle', 'password', 'did'] as const).map((field) => ({
      name: 'missing account ' + field,
      alter: ({ account }: State) => {
        delete account[field]
      },
    })),
    ...(['handle', 'password', 'did'] as const).map((field) => ({
      name: 'wrong-type account ' + field,
      alter: ({ account }: State) => {
        account[field] = 19
      },
    })),
    ...(['handle', 'password', 'did'] as const).map((field) => ({
      name: 'empty account ' + field,
      alter: ({ account }: State) => {
        account[field] = ''
      },
    })),
    ...(['handle', 'password', 'did'] as const).map((field) => ({
      name: 'mismatched restored ' + field,
      alter: ({ account }: State) => {
        account[field] = 'different-current-value'
      },
    })),
    {
      name: 'mismatched manifest provider',
      alter: ({ manifest }) => {
        manifest.pds = 'http://localhost:3999'
      },
    },
  ]
  it.each(invalidStates)(
    'R3 refuses $name without exposing private input',
    ({ name, alter, raw }) => {
      const harness = createHarness()
      alter(harness.state)
      const malformed =
        'qaidentity {"password":"qapassword","token":"qatoken","cookie":"qacookie","callback":' +
        JSON.stringify(callback)
      configure(
        harness,
        raw === 'manifest'
          ? { nextManifest: malformed }
          : raw === 'account'
            ? { nextAccount: malformed }
            : {},
      )
      const result = invoke(harness)
      expect
        .soft(result.status, 'invalid private state must fail ordinarily')
        .toBe(1)
      const requiredFetch =
        raw === 'manifest' ||
        name === 'missing manifest Mari' ||
        name === 'unsupported manifest version' ||
        name === 'mismatched manifest provider'
          ? 'manifest-fetch'
          : 'account-fetch'
      expect
        .soft(
          events(harness).some((event) => event.action === requiredFetch),
          'the invalid input must actually be fetched before validation',
        )
        .toBe(true)
      expectNoBrowser(harness, result)
      expectPrivateOutput(result, [
        String(harness.controls.nextManifest),
        String(harness.controls.nextAccount),
      ])
    },
  )

  it.each([
    { name: 'missing host', key: 'QA_BACKEND_HOST', value: undefined },
    {
      name: 'option-like host',
      key: 'QA_BACKEND_HOST',
      value: '-oProxyCommand=touch',
    },
    { name: 'missing checkout', key: 'QA_BACKEND_CHECKOUT', value: undefined },
    {
      name: 'relative checkout',
      key: 'QA_BACKEND_CHECKOUT',
      value: 'relative/coves',
    },
    {
      name: 'public web origin',
      key: 'OAUTH_WEB_BASE_URL',
      value: 'https://public.invalid',
    },
    {
      name: 'web userinfo',
      key: 'OAUTH_WEB_BASE_URL',
      value: 'http://user:password@127.0.0.1:8080',
    },
    {
      name: 'web path',
      key: 'OAUTH_WEB_BASE_URL',
      value: 'http://127.0.0.1:8080/path',
    },
    {
      name: 'malformed web URL',
      key: 'OAUTH_WEB_BASE_URL',
      value: 'not a URL',
    },
    { name: 'missing provider', key: 'PDS_URL', value: undefined },
    {
      name: 'public provider',
      key: 'PDS_URL',
      value: 'https://public.invalid',
    },
    {
      name: 'provider query',
      key: 'PDS_URL',
      value: 'http://localhost:3001/?query=private',
    },
    {
      name: 'provider fragment',
      key: 'PDS_URL',
      value: 'http://localhost:3001/#fragment',
    },
    {
      name: 'provider userinfo',
      key: 'PDS_URL',
      value: 'http://user:password@localhost:3001',
    },
  ])('R4 refuses $name before any transport', ({ key, value }) => {
    const harness = createHarness()
    if (value === undefined) delete harness.environment[key]
    else harness.environment[key] = value
    const result = invoke(harness)
    expect
      .soft(result.status, 'invalid local configuration must fail ordinarily')
      .toBe(1)
    expect
      .soft(
        transport(harness).length,
        'invalid configuration must not contact SSH',
      )
      .toBe(0)
    expect.soft(events(harness)).toEqual([])
    expectNoBrowser(harness, result)
  })

  it('R5 ignores both private fetched files in the actual checkout', () => {
    const result = spawnSync(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        'check-ignore',
        '--no-index',
        '--',
        '.dev-seed/manifest.json',
        '.dev-seed/oauth-test-account.json',
      ],
      { cwd: repository, encoding: 'utf8' },
    )
    expect(
      result.status,
      'both private paths must be ignored before they can hold credentials',
    ).toBe(0)
    expect(result.stdout.trim().split('\n').sort()).toEqual([
      '.dev-seed/manifest.json',
      '.dev-seed/oauth-test-account.json',
    ])
  })

  it.each(['directory', 'account file'])(
    'R6 refuses a private-state %s symlink without changing its target',
    (kind) => {
      const harness = createHarness()
      const sentinel = join(harness.root, 'external-sentinel')
      privateFile(sentinel, 'unchanged external sentinel\n')
      if (kind === 'directory') {
        rmSync(harness.stateDirectory, { recursive: true })
        const external = join(harness.root, 'external-directory')
        mkdirSync(external, { mode: 0o700 })
        copyFileSync(sentinel, join(external, 'oauth-test-account.json'))
        symlinkSync(external, harness.stateDirectory)
      } else {
        rmSync(join(harness.stateDirectory, 'oauth-test-account.json'))
        symlinkSync(
          sentinel,
          join(harness.stateDirectory, 'oauth-test-account.json'),
        )
      }
      const result = invoke(harness)
      expect
        .soft(
          result.status,
          'unsafe private-state path must fail before restore',
        )
        .toBe(1)
      expect.soft(transport(harness).length).toBe(0)
      expectNoBrowser(harness, result)
      expect(readFileSync(sentinel, 'utf8')).toBe(
        'unchanged external sentinel\n',
      )
      if (kind === 'directory')
        expect(
          readFileSync(
            join(harness.root, 'external-directory/oauth-test-account.json'),
            'utf8',
          ),
        ).toBe('unchanged external sentinel\n')
    },
  )

  it('R7 propagates the actual OAuth failure with private bounded diagnostics', () => {
    const harness = createHarness()
    configure(harness, { oauthExit: 47 })
    const result = invoke(harness)
    expect
      .soft(result.status, 'propagate the actual OAuth child failure')
      .toBe(47)
    expect
      .soft(
        events(harness).some((event) => event.action === 'oauth'),
        'the real host child boundary must be reached',
      )
      .toBe(true)
    expectPrivateOutput(result)
  })
})
