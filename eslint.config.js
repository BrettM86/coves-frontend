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
  // Ignore legacy code that will be replaced
  {
    ignores: [
      'src/lib/api/piefed/**',
      'src/lib/api/lemmy/adapter.ts',
      'src/lib/app/markdown/**',
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
)
