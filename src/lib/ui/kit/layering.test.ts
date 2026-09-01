import { ESLint } from 'eslint'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Pins the per-layer `no-restricted-imports` rule in eslint.config.js: which
 * imports each layer may make, and — just as important — which documented
 * exceptions must keep working. If this test fails after a config edit, the
 * layering guarantee described in CLAUDE.md has silently changed.
 */

const findRepoRoot = (start: string): string => {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, 'eslint.config.js'))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`no eslint.config.js above ${start}`)
    dir = parent
  }
}

const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)))

// Real, tsconfig-included paths. typescript-eslint's project service rejects
// a synthetic path with a fatal parse error and then runs no rules at all,
// which would make every "blocks" case below pass vacuously.
const KIT = 'src/lib/ui/kit/forms/helper.ts'
const UI = 'src/lib/ui/layout/index.ts'
const APP = 'src/lib/app/util/array.ts'
const API = 'src/lib/api/upload.ts'
const FEATURE = 'src/lib/feature/post/helpers.ts'
const ROUTE = 'src/routes/+page.ts'
const SERVER_ROUTE = 'src/routes/+layout.server.ts'

const RULE = '@typescript-eslint/no-restricted-imports'

let eslint: ESLint

beforeAll(() => {
  eslint = new ESLint({ cwd: REPO_ROOT })
})

const isBlocked = async (
  from: string,
  specifier: string,
  typeOnly = false,
): Promise<boolean> => {
  const source = typeOnly
    ? `import type { X } from '${specifier}'\nexport const x: X | null = null\n`
    : `import x from '${specifier}'\nexport const y = x\n`
  const [result] = await eslint.lintText(source, {
    filePath: join(REPO_ROOT, from),
  })
  const fatal = result.messages.find((m) => m.fatal)
  if (fatal) {
    throw new Error(`${from} did not parse, so no rule ran: ${fatal.message}`)
  }
  return result.messages.some((m) => m.ruleId === RULE)
}

describe('layering rule', () => {
  it.each([
    [KIT, '$lib/app/state/settings.svelte'],
    [KIT, '$lib/feature/post/helpers'],
    [KIT, '$lib/api/upload'],
    [KIT, '$lib/server/session'],
    [KIT, '$lib/ui/generic/Avatar.svelte'],
    [KIT, '../../generic/Avatar.svelte'],
    [KIT, '../../../feature/post/helpers'],
    [UI, '$lib/feature/post/helpers'],
    [UI, '../../feature/post/helpers'],
    [UI, '$lib/server/session'],
    [APP, '$lib/ui/kit'],
    [APP, '$lib/feature/post/helpers'],
    [APP, '$lib/server/session'],
    [API, '$lib/ui/kit'],
    [API, '$lib/feature/post/helpers'],
    [API, '$lib/server/session'],
    [FEATURE, '$lib/server/session'],
    [ROUTE, '$lib/server/session'],
  ])('blocks %s importing %s', async (from, specifier) => {
    expect(await isBlocked(from, specifier)).toBe(true)
  }, 30_000)

  it.each([
    [KIT, './helper'],
    [KIT, '$lib/ui/kit'],
    [KIT, '$lib/ui/kit/button/Button.svelte'],
    [KIT, '$lib/types/atproto'],
    [UI, '$lib/app/util/array'],
    [UI, '$lib/api/upload'],
    [UI, '$lib/ui/kit'],
    [APP, '$lib/api/coves/sort'],
    [FEATURE, '$lib/ui/kit'],
    [FEATURE, '$lib/app/state/settings.svelte'],
    [ROUTE, '$lib/feature/post/helpers'],
    [SERVER_ROUTE, '$lib/server/session'],
    // Documented exception: api/client.svelte.ts reads the active profile.
    [API, '$lib/app/state/auth.svelte'],
  ])('allows %s importing %s', async (from, specifier) => {
    expect(await isBlocked(from, specifier)).toBe(false)
  }, 30_000)

  it('allows type-only imports from a forbidden layer', async () => {
    expect(await isBlocked(APP, '$lib/server/session', true)).toBe(false)
    expect(await isBlocked(KIT, '$lib/feature/post/helpers', true)).toBe(false)
  })
})
