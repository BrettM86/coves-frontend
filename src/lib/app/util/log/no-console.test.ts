import { ESLint } from 'eslint'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Pins the `no-console` fence in eslint.config.js. Every layer that can end up
 * in the server bundle must route through the isomorphic logger, because a
 * raw `console.error(err)` prints an unscrubbed error — headers, cookies, a
 * whole OAuth URL — straight to stderr. This test is the only thing standing
 * between a config edit and that leak coming back.
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

const RULE = 'no-console'

const TS_SOURCE = "console.error('x')\n"
const SVELTE_SOURCE = '<script lang="ts">\n  console.error(\'x\')\n</script>\n'

// Real, tsconfig-included paths. typescript-eslint's project service can
// answer a fatal parse error for a synthetic path and then run no rules at
// all, which would make every "reports" case below pass vacuously — so the
// helper turns any fatal into a thrown error rather than a silent `false`.
const APP = 'src/lib/app/util/array.ts'
const API = 'src/lib/api/coves/sort.ts'
const FEATURE = 'src/lib/feature/post/helpers.ts'
const FEATURE_SVELTE = 'src/lib/feature/post/Post.svelte'
const HOOKS = 'src/hooks.server.ts'
const APP_TEST = 'src/lib/app/util/array.test.ts'
const LOG_INDEX = 'src/lib/app/util/log/index.ts'
const LOG_SCRUB = 'src/lib/app/util/log/scrub.ts'
// Universal route files: they run on the server for SSR, so a console there
// prints to the same stderr a shipper reads.
const ROUTE_PAGE = 'src/routes/settings/+page.ts'
const ROUTE_LAYOUT = 'src/routes/util/+layout.ts'
const ROUTE_SVELTE = 'src/routes/util/+page.svelte'
const UI_SVELTE = 'src/lib/ui/form/FreeTextInput.svelte'
// ui/kit is a leaf that may not import $lib/app, so it cannot reach the logger
// directly — it has to take one by prop. The fence applies regardless: the
// alternative is an unscrubbed console in a component that server-renders.
const KIT_SVELTE = 'src/lib/ui/kit/search/Search.svelte'

let eslint: ESLint

beforeAll(() => {
  eslint = new ESLint({ cwd: REPO_ROOT })
})

const reportsConsole = async (from: string): Promise<boolean> => {
  const source = from.endsWith('.svelte') ? SVELTE_SOURCE : TS_SOURCE
  const [result] = await eslint.lintText(source, {
    filePath: join(REPO_ROOT, from),
  })
  const fatal = result?.messages.find((m) => m.fatal)
  if (fatal) {
    throw new Error(`${from} did not parse, so no rule ran: ${fatal.message}`)
  }
  return (result?.messages ?? []).some((m) => m.ruleId === RULE)
}

describe('no-console fence', () => {
  it.each([
    [APP],
    [API],
    [FEATURE],
    [FEATURE_SVELTE],
    [ROUTE_PAGE],
    [ROUTE_LAYOUT],
    [ROUTE_SVELTE],
    [UI_SVELTE],
    [KIT_SVELTE],
    // Control: already fenced today, so a harness that silently stopped
    // running the rule would fail here instead of passing everything.
    [HOOKS],
  ])('reports console.error in %s', async (from) => {
    expect(await reportsConsole(from)).toBe(true)
  }, 30_000)

  it.each([
    // The logger itself is the one place allowed to reach a console.
    [LOG_INDEX],
    [LOG_SCRUB],
    // Tests assert on console output, so they must be able to name it.
    [APP_TEST],
  ])('allows console.error in %s', async (from) => {
    expect(await reportsConsole(from)).toBe(false)
  }, 30_000)
})
