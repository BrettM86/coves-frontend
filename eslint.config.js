import js from '@eslint/js'
import { includeIgnoreFile } from '@eslint/compat'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'
import { fileURLToPath } from 'node:url'
import ts from 'typescript-eslint'
import svelteConfig from './svelte.config.js'

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url))

export default ts.config(
  includeIgnoreFile(gitignorePath),
  // Ignore legacy code that will be replaced.
  //
  // src/lib/feature/markdown is deliberately NOT ignored: it renders untrusted
  // post and comment bodies, and svelte/no-at-html-tags below is the tripwire
  // for XSS sinks there. A directory-wide ignore would switch that off silently.
  {
    ignores: [
      'src/lib/api/piefed/**',
      'src/lib/api/lemmy/adapter.ts',
      // Local git worktrees created by Claude Code sessions
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
      // see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
      'no-undef': 'off',
      // sveltekit should make this native then
      'svelte/valid-prop-names-in-kit-pages': 'off',
      // {@html} is an XSS sink — every use needs an explicit, justified
      // eslint-disable comment (a shared-component use once shipped as a
      // mutation-XSS landmine because this rule was off)
      'svelte/no-at-html-tags': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      'svelte/require-each-key': 'off',
      'svelte/prefer-writable-derived': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'svelte/no-navigation-without-resolve': 'off',
      // _-prefix marks intentionally-unused bindings (exhaustiveness checks,
      // stubbed params, discarded destructures)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: [
      'src/lib/**/*.ts',
      '**/*.svelte',
      '**/*.svelte.ts',
      '**/*.svelte.js',
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig,
      },
    },
  },
  // ---------------------------------------------------------------------------
  // Layering. Each layer may import only from the layers below it:
  //
  //   routes/  →  feature/  →  ui/  →  app/ (state, util)  →  api/
  //                                    ui/kit/ (imports none of the above)
  //
  // `$lib/types` is shared by every layer, and `$lib/server` is off-limits to
  // every client-shipped layer (type-only imports of it are allowed — they are
  // erased). `api/client.svelte.ts` reaching into `app/state` for the active
  // profile is a known, tolerated exception — it is why `api/` is not
  // restricted from `app/` here.
  //
  // Known limits: the rule is lexical, so `./../x` or `$lib/../x` spellings
  // and dynamic `import()` expressions are not caught. Nothing in the tree
  // uses either; src/lib/ui/kit/layering.test.ts pins the covered cases.
  // ---------------------------------------------------------------------------
  ...layerRules([
    {
      files: ['src/lib/ui/kit/**'],
      forbid: ['app', 'feature', 'api', 'server'],
      // The kit may only import itself: no non-kit ui/ via the alias, and no
      // parent-relative path at all (kit-internal imports are `./` or `$lib/ui/kit`).
      alsoForbid: ['^\\$lib/ui/(?!kit(/|$))', '^\\.\\.(/|$)'],
      why: 'the kit is the leaf UI layer; pass app state in via props or snippets',
    },
    {
      files: ['src/lib/ui/**'],
      ignores: ['src/lib/ui/kit/**'],
      forbid: ['feature', 'server'],
      why: 'ui/ is below feature/; page compositions belong in feature/shell',
    },
    {
      files: ['src/lib/app/**'],
      forbid: ['feature', 'ui', 'server'],
      why: 'app/ holds state and utilities only',
    },
    {
      files: ['src/lib/api/**'],
      forbid: ['feature', 'ui', 'server'],
      why: 'api/ is the bottom layer',
    },
    {
      files: ['src/lib/feature/**'],
      forbid: ['server'],
      why: 'feature/ ships to the client',
    },
    {
      files: ['src/routes/**'],
      ignores: [
        'src/routes/**/*.server.ts',
        'src/routes/**/+server.ts',
        // API routes are server-only end to end, helpers included.
        'src/routes/api/**',
        'src/routes/**/*.test.ts',
      ],
      forbid: ['server'],
      why: 'only server-side route files (*.server.ts, +server.ts, routes/api) may use $lib/server',
    },
  ]),
  // Anything that can end up in the SERVER bundle must log through the
  // isomorphic logger ($lib/app/util/log, or $lib/server/log for server-only
  // callers) — never console.* directly. The logger emits one JSON line per
  // event with the request id and scrubs secrets out of messages, stacks and
  // URLs; a raw console.error(err) prints an unscrubbed error — headers,
  // cookies, a whole OAuth URL — straight to stderr, where it is archived.
  //
  // `app/`, `api/`, `feature/`, `routes/` and `ui/` are all covered because SSR
  // runs them too: a console in a universal route file or a shared component
  // prints to the same stderr a `+page.server.ts`'s would. `ui/kit` is a leaf
  // that may not import `$lib/app`, so it cannot reach the logger itself — it
  // takes one by prop from its caller. The fence applies to it regardless; the
  // alternative is an unscrubbed console in a component that server-renders.
  //
  // The browser half of the logger reaches a console deliberately, so the
  // logger's own directory is exempt. `src/hooks.client.ts` is deliberately NOT
  // listed: it only ever runs in the browser, where there is no stderr to leak
  // to and no request to correlate.
  {
    files: [
      'src/hooks.server.ts',
      'src/lib/server/**/*.ts',
      'src/lib/app/**/*.{ts,svelte}',
      'src/lib/api/**/*.{ts,svelte}',
      'src/lib/feature/**/*.{ts,svelte}',
      'src/lib/ui/**/*.{ts,svelte}',
      'src/routes/**/*.{ts,svelte}',
    ],
    ignores: ['src/lib/app/util/log/**', '**/*.test.ts', '**/*.test.svelte.ts'],
    rules: { 'no-console': 'error' },
  },
)

/**
 * Builds a `no-restricted-imports` config block per layer. `forbid` lists
 * top-level `src/lib` directories; each is blocked both as `$lib/<dir>` and as
 * a parent-relative path (`../../<dir>/x`). `alsoForbid` takes raw regex
 * sources for anything finer-grained. The typescript-eslint flavour of the
 * rule is used so `import type` from a forbidden layer stays legal.
 */
function layerRules(layers) {
  return layers.map(({ files, ignores, forbid, alsoForbid = [], why }) => ({
    files,
    ...(ignores ? { ignores } : {}),
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: [
                `^(\\$lib/|(\\.\\./)+)(${forbid.join('|')})(/|$)`,
                ...alsoForbid,
              ]
                .map((source) => `(?:${source})`)
                .join('|'),
              message: `Layering violation: ${why}.`,
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  }))
}
