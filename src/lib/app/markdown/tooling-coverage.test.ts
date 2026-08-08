import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'
import ts from 'typescript'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Tooling-coverage regression guard.
//
// src/lib/app/markdown renders untrusted post and comment bodies. It spent a
// long stretch excluded from both typecheck and lint, which is how an unguarded
// href reached an <img src> unnoticed. These assertions make any silent
// re-exclusion — or a fresh type-suppression pragma, or a new raw-HTML sink —
// fail the suite instead of passing quietly.
//
// Everything resolves from the repo root discovered off this module's own URL,
// so the test behaves the same no matter where vitest is invoked from.
//
// WATCH OUT when adding a scan: this file lives inside the directory it scans,
// so any needle spelled literally anywhere here — including in a comment, a
// test name, or a failure message — makes the assertion match this file and
// fail. That has already happened three times. Assemble needles at runtime
// (see the pragma, raw-HTML and Svelte-suppression scans below) and describe
// them in prose rather than writing the token out.
// ---------------------------------------------------------------------------

const findRepoRoot = (start: string): string => {
  let dir = start
  for (;;) {
    if (
      existsSync(join(dir, 'package.json')) &&
      existsSync(join(dir, 'tsconfig.json'))
    ) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`Could not locate the repo root walking up from ${start}`)
    }
    dir = parent
  }
}

const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)))

/** The guarded directory, as it appears in config globs (always POSIX-style). */
const GUARDED_PATH = 'src/lib/app/markdown'
const GUARDED_DIR = join(REPO_ROOT, 'src', 'lib', 'app', 'markdown')

const WHY_TYPECHECK =
  `${GUARDED_PATH} is the untrusted-input rendering surface for posts and ` +
  `comments; it must stay under typecheck. If you are excluding it to silence ` +
  `errors, fix the errors instead.`

const WHY_LINT =
  `${GUARDED_PATH} must stay under ESLint. The svelte/no-at-html-tags rule is ` +
  `the tripwire for XSS sinks in this directory, and an ignore entry disables ` +
  `it silently. If a rule is genuinely wrong here, disable that one rule with ` +
  `a justification, not the whole directory.`

const WHY_PRAGMAS =
  `Type-suppression pragmas turn off exactly the checking this directory most ` +
  `needs — the renderers take untrusted href/src values. Type the value ` +
  `properly, or narrow it, instead of suppressing the error.`

const WHY_SVELTE_IGNORE =
  `A Svelte suppression comment silences a svelte-check diagnostic for one ` +
  `line — the same per-line blindness the type-suppression pragmas gave this ` +
  `directory, just in Svelte's dialect. The renderers here take untrusted ` +
  `href/src values; fix what the compiler objects to rather than muting it.`

const WHY_HTML_SINK =
  `The Svelte raw-HTML block injects unescaped markup, and this directory's ` +
  `input is attacker-controlled. Render through a component instead. If there ` +
  `is genuinely no alternative, that needs a security review, not a lint ` +
  `suppression.`

const WHY_SANITIZER =
  `sanitize-markdown was removed deliberately: allowlisting at the render ` +
  `boundary (isSafeHref in renderers/plugins) is the defense, and a sanitizer ` +
  `dependency invites the "it is already sanitized" assumption that lets ` +
  `unguarded sinks back in.`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every file under the guarded directory, as repo-relative POSIX paths. */
const guardedFiles = (): string[] => {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile())
        found.push(relative(REPO_ROOT, full).split(sep).join('/'))
    }
  }
  walk(GUARDED_DIR)
  return found.sort()
}

/** Repo-relative paths of guarded files whose contents contain `needle`. */
const guardedFilesContaining = (needle: string): string[] =>
  guardedFiles().filter((file) =>
    readFileSync(join(REPO_ROOT, file), 'utf8').includes(needle),
  )

/** Representative files inside the guarded directory, by real extension. */
const GUARDED_SVELTE = join(GUARDED_DIR, 'Markdown.svelte')
const GUARDED_TS = join(GUARDED_DIR, 'renderers', 'plugins.ts')

/**
 * The file list tsc itself would compile, resolved through the real config
 * parser. Asking "is this file covered?" survives glob rewrites like
 * 'src/lib/app/**' that a substring check on the exclude list would miss, and
 * it accepts exactly the JSONC that tsc accepts.
 */
const typescriptProgramFiles = (): string[] => {
  const configPath = join(REPO_ROOT, 'tsconfig.json')
  const read = ts.readConfigFile(configPath, ts.sys.readFile)
  if (read.error) {
    throw new Error(
      `${configPath} could not be read, so its coverage could not be checked: ` +
        ts.flattenDiagnosticMessageText(read.error.messageText, ' '),
    )
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    REPO_ROOT,
    undefined,
    configPath,
    undefined,
    // Without this tsc reports no .svelte files at all and the assertion below
    // would fail for the wrong reason.
    [
      {
        extension: '.svelte',
        isMixedContent: true,
        scriptKind: ts.ScriptKind.Deferred,
      },
    ],
  )
  if (parsed.errors.length > 0) {
    throw new Error(
      `${configPath} produced ${parsed.errors.length} config error(s), so its coverage could not be checked.`,
    )
  }
  return parsed.fileNames
}

const eslintForRepo = (): ESLint => new ESLint({ cwd: REPO_ROOT })

/** ESLint severity as a word, whatever shape the resolved config uses. */
const ruleLevel = (entry: unknown): string => {
  const value = Array.isArray(entry) ? entry[0] : entry
  if (value === 2 || value === 'error') return 'error'
  if (value === 1 || value === 'warn') return 'warn'
  if (value === 0 || value === 'off') return 'off'
  return `unknown(${JSON.stringify(value)})`
}

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

// ---------------------------------------------------------------------------
// 1. tsc must actually compile the directory
// ---------------------------------------------------------------------------

describe('tooling coverage - typecheck', () => {
  it('includes the markdown directory in the TypeScript program', () => {
    const files = typescriptProgramFiles()
    const missing = [GUARDED_SVELTE, GUARDED_TS].filter(
      (file) => !files.includes(file),
    )
    expect(missing, WHY_TYPECHECK).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2. ESLint must actually lint the directory, with its XSS rule armed
// ---------------------------------------------------------------------------

describe('tooling coverage - lint', () => {
  it('does not ignore files in the markdown directory', async () => {
    const eslint = eslintForRepo()
    const ignored: string[] = []
    for (const file of [GUARDED_SVELTE, GUARDED_TS]) {
      if (await eslint.isPathIgnored(file)) ignored.push(file)
    }
    expect(ignored, WHY_LINT).toEqual([])
  })

  it('keeps svelte/no-at-html-tags armed as an error there', async () => {
    // The directory being linted is worth nothing if the rule that guards it
    // has been switched off — a far smaller edit than re-adding an ignore.
    const config = await eslintForRepo().calculateConfigForFile(GUARDED_SVELTE)
    const rules = (config as { rules?: Record<string, unknown> }).rules ?? {}
    expect(ruleLevel(rules['svelte/no-at-html-tags']), WHY_LINT).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// 3. No type-suppression pragmas anywhere in the directory
// ---------------------------------------------------------------------------

describe('tooling coverage - type suppression', () => {
  // Built at runtime so this file does not trip its own assertion.
  const pragmas = ['ts-nocheck', 'ts-ignore', 'ts-expect-error'].map(
    (name) => `@${name}`,
  )

  it.each(pragmas)(
    'has no %s pragma under the markdown directory',
    (pragma) => {
      expect(guardedFilesContaining(pragma), WHY_PRAGMAS).toEqual([])
    },
  )
})

// ---------------------------------------------------------------------------
// 3b. No svelte-check suppressions anywhere in the directory
// ---------------------------------------------------------------------------

describe('tooling coverage - svelte-check suppression', () => {
  it('has no Svelte suppression comment under the markdown directory', () => {
    // Assembled at runtime, same reason as the pragmas above.
    const needle = 'svelte-' + 'ignore'
    expect(guardedFilesContaining(needle), WHY_SVELTE_IGNORE).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. No raw-HTML sink anywhere in the directory
// ---------------------------------------------------------------------------

describe('tooling coverage - html sink', () => {
  it('has no raw-HTML block under the markdown directory', () => {
    // Assembled at runtime, same reason as the pragmas above.
    const sink = '{' + '@html'
    expect(guardedFilesContaining(sink), WHY_HTML_SINK).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 5. No sanitizer dependency
// ---------------------------------------------------------------------------

describe('tooling coverage - dependencies', () => {
  it('does not depend on sanitize-markdown in any section', () => {
    const raw = readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as PackageJson
    const sections = DEPENDENCY_SECTIONS.filter((section) =>
      Object.hasOwn(pkg[section] ?? {}, 'sanitize-markdown'),
    )
    expect(sections, WHY_SANITIZER).toEqual([])
  })
})
