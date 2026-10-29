// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { Theme } from '$lib/app/state/theme/theme.svelte'
import {
  buttonNamed as buttonNamedIn,
  useThemeHarness,
} from './themeTestHarness'

vi.mock('$app/environment', async () =>
  (await import('./themeTestHarness')).appEnvironmentModule(),
)
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/state', async () =>
  (await import('./themeTestHarness')).appStateModule(),
)
vi.mock('$app/navigation', async () =>
  (await import('./themeTestHarness')).appNavigationModule(),
)
vi.mock('$lib/app/state/i18n', async () =>
  (await import('./themeTestHarness')).i18nModule(),
)
vi.mock('svelte', async () =>
  (await import('./themeTestHarness')).svelteClientEntry('src/index-client.js'),
)
vi.mock('svelte/reactivity', async () =>
  (await import('./themeTestHarness')).svelteClientEntry(
    'src/reactivity/index-client.js',
  ),
)
vi.mock('svelte/transition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/transition')>()),
  fade: () => ({ duration: 0 }),
  scale: () => ({ duration: 0 }),
}))

const harness = useThemeHarness()

function themeById(id: number): Theme {
  const found = harness.themeState.data.themes.find((theme) => theme.id === id)
  if (!found) throw new Error(`Missing theme ${id}`)
  return found
}

async function mountCard(id: number) {
  const ThemePreset = (await import('./ThemePreset.svelte')).default
  harness.mount(ThemePreset, { theme: themeById(id) })
}

const mountModalHost = () => harness.mountModalHost()

function buttonNamed(
  name: string,
  scope: ParentNode = harness.target,
): HTMLButtonElement {
  return buttonNamedIn(name, scope)
}

/**
 * jsdom's CSSStyleDeclaration drops space-separated `rgb(r g b)` values, so
 * read the declaration from the style attribute and normalise either rgb
 * syntax to an 'r g b' triple.
 */
function inlineRgb(element: HTMLElement | null, property: string): string {
  const style = element?.getAttribute('style') ?? ''
  const match = new RegExp(
    `(?:^|;)\\s*${property}\\s*:\\s*rgb\\(([^)]*)\\)`,
  ).exec(style)
  if (!match) return ''
  return (match[1] ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .join(' ')
}

function selectControl(): HTMLElement {
  const found = harness.target.querySelector<HTMLElement>(
    'button[aria-pressed]',
  )
  if (!found) throw new Error('Missing select control')
  return found
}

function nameInput(): HTMLInputElement | null {
  return harness.target.querySelector<HTMLInputElement>(
    'input[type="text"], input:not([type])',
  )
}

function startRename(): HTMLInputElement {
  const nameButton = [...harness.target.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Custom 1',
  )
  if (!nameButton) throw new Error('Missing name button')
  nameButton.click()
  harness.client.flushSync()
  const input = nameInput()
  if (!input) throw new Error('Rename input did not appear')
  return input
}

function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  harness.client.flushSync()
}

function press(input: HTMLInputElement, key: string) {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  harness.client.flushSync()
}

describe('ThemePreset', () => {
  it('never nests a button inside another button', async () => {
    await mountCard(1)
    expect(harness.target.querySelector('button button')).toBeNull()

    startRename()
    expect(harness.target.querySelector('button button')).toBeNull()
  })

  it.each([-1, 1])('exposes a Duplicate action on theme %i', async (id) => {
    await mountCard(id)

    expect(() => buttonNamed('routes.theme.preset.duplicate')).not.toThrow()
  })

  it('duplicating a preset creates and selects a named custom copy', async () => {
    await mountCard(-1)

    buttonNamed('routes.theme.preset.duplicate').click()
    harness.client.flushSync()

    expect(harness.themeState.data.currentTheme).toBeGreaterThan(0)
    expect(harness.themeState.data.themes.map((theme) => theme.id)).toContain(
      harness.themeState.data.currentTheme,
    )
    expect(harness.themeState.current.name.trim()).not.toBe('')
  })

  it.each([-1, 1])('selecting card %i makes it current', async (id) => {
    await mountCard(id)

    selectControl().click()
    harness.client.flushSync()

    expect(harness.themeState.data.currentTheme).toBe(id)
    expect(selectControl().getAttribute('aria-pressed')).toBe('true')
  })

  it('deletes a non-current theme without changing the selection', async () => {
    await mountCard(1)
    await mountModalHost()

    buttonNamed('routes.theme.preset.delete').click()
    harness.client.flushSync()
    expect(harness.themeState.data.currentTheme).toBe(2)

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    buttonNamed(
      'routes.theme.preset.delete.confirm',
      dialog ?? document,
    ).click()
    await vi.waitFor(() => {
      expect(
        harness.themeState.data.themes.map((theme) => theme.id),
      ).not.toContain(1)
    })
    harness.client.flushSync()

    expect(harness.themeState.data.currentTheme).toBe(2)
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(document.body.textContent).not.toMatch(
      /undefined|can't access|Cannot read|not implemented/,
    )
  })

  it.each([
    {
      scheme: 'light' as const,
      systemDark: false,
      background: '248 250 252',
      text: '15 23 42',
    },
    {
      scheme: 'dark' as const,
      systemDark: false,
      background: '25 25 29',
      text: '248 248 251',
    },
    {
      scheme: 'system' as const,
      systemDark: true,
      background: '25 25 29',
      text: '248 248 251',
    },
  ])(
    'previews the $scheme colour scheme (system dark: $systemDark)',
    async ({ scheme, systemDark, background, text }) => {
      harness.setPrefersDark(systemDark)
      harness.themeState.colorScheme = scheme
      harness.client.flushSync()
      await mountCard(1)

      const preview = harness.target.querySelector<HTMLElement>(
        '[data-testid="theme-preview"]',
      )
      expect(preview).not.toBeNull()
      expect(inlineRgb(preview, 'background-color')).toBe(background)
      expect(inlineRgb(preview, 'color')).toBe(text)
    },
  )

  describe('rename', () => {
    it('Enter commits the new name and closes the editor', async () => {
      await mountCard(1)
      const input = startRename()

      type(input, 'Ocean')
      press(input, 'Enter')

      expect(themeById(1).name).toBe('Ocean')
      expect(nameInput()).toBeNull()
    })

    it('blur commits the new name', async () => {
      await mountCard(1)
      const input = startRename()

      input.focus()
      type(input, 'Ocean')
      input.blur()
      harness.client.flushSync()

      expect(themeById(1).name).toBe('Ocean')
      expect(nameInput()).toBeNull()
    })

    it('Escape restores the previous name', async () => {
      await mountCard(1)
      const input = startRename()

      type(input, 'Ocean')
      press(input, 'Escape')

      expect(themeById(1).name).toBe('Custom 1')
      expect(nameInput()).toBeNull()
    })

    it('an empty name restores the previous name', async () => {
      await mountCard(1)
      const input = startRename()

      type(input, '')
      press(input, 'Enter')

      expect(themeById(1).name).toBe('Custom 1')
      expect(nameInput()).toBeNull()
    })
  })
})
