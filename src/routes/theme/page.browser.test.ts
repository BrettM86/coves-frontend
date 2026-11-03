// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import {
  accessibleName,
  buttonNamed as buttonNamedIn,
  kelpColors,
  useThemeHarness,
} from './themeTestHarness'
import { tintNeutrals } from '$lib/app/state/theme/tint'
import type { ThemeColors } from '$lib/app/state/theme/theme.svelte'

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

async function mountPage() {
  const { toasts } = await import('$lib/ui/kit/toast/toasts')
  toasts.set([])
  const Page = (await import('./+page.svelte')).default
  harness.mount(Page, {})
}

function buttonNamed(
  name: string,
  scope: ParentNode = document.body,
): HTMLButtonElement {
  return buttonNamedIn(name, scope)
}

function click(element: HTMLElement) {
  element.click()
  harness.client.flushSync()
}

async function toastContents(): Promise<string[]> {
  const { toasts } = await import('$lib/ui/kit/toast/toasts')
  return get(toasts).map((toast) => String(toast.content))
}

function useCustomTheme() {
  harness.themeState.data.currentTheme = 1
  harness.client.flushSync()
}

function firstColorInput(): HTMLInputElement {
  const input = harness.target.querySelector<HTMLInputElement>(
    'input[type="color"]',
  )
  if (!input) throw new Error('Missing colour input')
  return input
}

function openImportDialog(): HTMLElement {
  click(buttonNamed('settings.import', harness.target))
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!dialog) throw new Error('Import dialog did not open')
  return dialog
}

/** Mounts the page on custom theme 1 with a red primary-900. */
async function mountRedAccentTheme() {
  const colors = kelpColors()
  colors.primary['900'] = '220 38 38'
  harness.themeState.data.themes = [
    ...harness.themeState.data.themes.filter((theme) => theme.id !== 1),
    { id: 1, name: 'Custom 1', colors },
  ]
  useCustomTheme()
  await mountPage()
}

/** The Accent section: the nearest container of its heading that holds a colour input. */
function accentSection(): HTMLElement {
  const heading = [...harness.target.querySelectorAll<HTMLElement>('*')].find(
    (element) =>
      element.children.length === 0 &&
      element.textContent?.trim() === 'routes.theme.accent',
  )
  let section = heading?.parentElement ?? null
  while (section && !section.querySelector('input[type="color"]'))
    section = section.parentElement
  if (!section) throw new Error('Missing Accent section')
  return section
}

/** A scheme control: a button or radio, found by its accessible name. */
function schemeControl(name: string): HTMLElement {
  const found = [
    ...harness.target.querySelectorAll<HTMLElement>(
      'button, [role="radio"], input[type="radio"]',
    ),
  ].find((element) => accessibleName(element) === name)
  if (!found) throw new Error(`Missing colour scheme control ${name}`)
  return found
}

/** aria-pressed of the Subtle, Medium and Strong tint buttons, in that order. */
function pressedStrengths(section: HTMLElement): (string | null)[] {
  return [
    'routes.theme.tint.subtle',
    'routes.theme.tint.medium',
    'routes.theme.tint.strong',
  ].map((name) => buttonNamed(name, section).getAttribute('aria-pressed'))
}

/** A plain copy of the current theme's colours, detached from the state. */
function currentColorsCopy(): ThemeColors {
  return JSON.parse(JSON.stringify(harness.themeState.current.colors))
}

/** Every colour swatch's picker, hex field and per-swatch reset button. */
function swatchControls() {
  const colorInputs = [
    ...harness.target.querySelectorAll<HTMLInputElement>('input[type="color"]'),
  ]
  const hexFields = [
    ...harness.target.querySelectorAll<HTMLInputElement>(
      'input[aria-label$="routes.theme.swatch.hex"]',
    ),
  ]
  const resetButtons = [
    ...harness.target.querySelectorAll<HTMLButtonElement>('button'),
  ].filter((button) => accessibleName(button).startsWith('settings.reset '))
  return { colorInputs, hexFields, resetButtons }
}

function zincNineHundredHexField(): HTMLInputElement {
  const field = harness.target.querySelector<HTMLInputElement>(
    'input[aria-label^="routes.theme.category.zinc 900,"]',
  )
  if (!field) throw new Error('Missing zinc 900 hex field')
  return field
}

describe('theme page', () => {
  it.each([
    {
      kind: 'Classic preset',
      themeId: -1,
      zincHex: '#121215',
      editable: false,
    },
    { kind: 'custom theme', themeId: 1, zincHex: '#222227', editable: true },
  ])(
    'a $kind shows its colours at full strength, editable only when custom',
    async ({ themeId, zincHex, editable }) => {
      harness.themeState.data.currentTheme = themeId
      harness.client.flushSync()
      await mountPage()

      const { colorInputs, hexFields, resetButtons } = swatchControls()
      expect(colorInputs.length).toBeGreaterThan(0)
      expect(hexFields).toHaveLength(colorInputs.length)
      for (const input of [...colorInputs, ...hexFields]) {
        expect(input.closest('[inert]')).toBeNull()
        expect(input.closest('.opacity-50')).toBeNull()
      }
      expect(zincNineHundredHexField().value).toBe(zincHex)
      for (const field of hexFields) {
        expect(field.readOnly).toBe(!editable)
        expect(field.disabled).toBe(false)
      }
      for (const input of colorInputs) expect(input.disabled).toBe(!editable)
      expect(resetButtons).toHaveLength(editable ? colorInputs.length : 0)
    },
  )

  it('disables the tint strengths and tint Reset on a preset', async () => {
    harness.themeState.data.currentTheme = -1
    harness.client.flushSync()
    await mountPage()
    const section = accentSection()

    expect(
      [
        'routes.theme.tint.subtle',
        'routes.theme.tint.medium',
        'routes.theme.tint.strong',
        'routes.theme.tint.reset',
      ].map((name) => buttonNamed(name, section).disabled),
    ).toEqual([true, true, true, true])
  })

  it('offers Duplicate for a preset and makes the copy editable', async () => {
    harness.themeState.data.currentTheme = 0
    harness.client.flushSync()
    await mountPage()

    click(buttonNamed('routes.theme.preset.duplicate', harness.target))

    expect(harness.themeState.data.currentTheme).toBeGreaterThan(0)
    const input = firstColorInput()
    expect(input.disabled).toBe(false)
    expect(input.closest('.pointer-events-none')).toBeNull()
    expect(input.closest('[inert]')).toBeNull()
  })

  it('New copies the edited colours of the current custom theme', async () => {
    const edited = kelpColors()
    edited.zinc['900'] = '255 0 0'
    harness.themeState.data.themes = [
      ...harness.themeState.data.themes.filter((theme) => theme.id !== 1),
      { id: 1, name: 'Custom 1', colors: edited },
    ]
    useCustomTheme()
    await mountPage()

    click(buttonNamed('routes.theme.preset.new', harness.target))

    expect(harness.themeState.data.currentTheme).not.toBe(1)
    expect(harness.themeState.data.currentTheme).toBeGreaterThan(0)
    expect(harness.themeState.current.colors.zinc['900']).toBe('255 0 0')
  })

  it('rejects invalid import JSON with a translated error and keeps the dialog open', async () => {
    useCustomTheme()
    await mountPage()
    const dialog = openImportDialog()
    const textarea = dialog.querySelector('textarea')
    if (!textarea) throw new Error('Missing import textarea')

    textarea.value = 'nope'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    harness.client.flushSync()
    click(buttonNamed('settings.import', dialog))

    expect(await toastContents()).toContain('routes.theme.import.invalidJson')
    expect(harness.themeState.current.colors).toEqual(kelpColors())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('exports the named theme to the clipboard and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    useCustomTheme()
    await mountPage()

    click(buttonNamed('settings.export', harness.target))

    await vi.waitFor(async () => {
      expect(await toastContents()).toContain('routes.theme.export.copied')
    })
    expect(writeText).toHaveBeenCalledTimes(1)
    const exported = JSON.parse(String(writeText.mock.calls[0]?.[0])) as {
      name?: unknown
      colors?: { zinc?: Record<string, unknown> }
    }
    expect(exported.name).toBe('Custom 1')
    expect(exported.colors?.zinc?.['900']).toBe('34 34 39')
  })

  it('reports a failed clipboard export with a translated error', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    useCustomTheme()
    await mountPage()

    click(buttonNamed('settings.export', harness.target))

    await vi.waitFor(async () => {
      expect(await toastContents()).toContain('routes.theme.export.failed')
    })
  })

  it.each([
    { name: 'nav.menu.colorscheme.light', scheme: 'light' },
    { name: 'nav.menu.colorscheme.dark', scheme: 'dark' },
    { name: 'nav.menu.colorscheme.system', scheme: 'system' },
  ] as const)(
    'the $scheme scheme control sets the colour scheme',
    async ({ name, scheme }) => {
      harness.themeState.colorScheme = scheme === 'dark' ? 'light' : 'dark'
      harness.client.flushSync()
      await mountPage()

      click(schemeControl(name))

      expect(harness.themeState.colorScheme).toBe(scheme)
    },
  )

  it('warns about low contrast only once the accent fails it', async () => {
    useCustomTheme()
    await mountPage()
    expect(harness.target.textContent).not.toContain(
      'routes.theme.contrast.warning',
    )

    harness.themeState.setColor('primary', '900', '#f8fafc')
    harness.client.flushSync()

    expect(harness.target.textContent).toContain(
      'routes.theme.contrast.warning',
    )
  })

  it('presses no strength before tinting', async () => {
    await mountRedAccentTheme()
    const section = accentSection()

    expect(pressedStrengths(section)).toEqual(['false', 'false', 'false'])
  })

  it.each([
    { strength: 'subtle', pressed: ['true', 'false', 'false'] },
    { strength: 'medium', pressed: ['false', 'true', 'false'] },
    { strength: 'strong', pressed: ['false', 'false', 'true'] },
  ] as const)(
    'clicking $strength tints slate and zinc at once and presses it',
    async ({ strength, pressed }) => {
      await mountRedAccentTheme()
      const original = currentColorsCopy()
      const section = accentSection()

      click(buttonNamed(`routes.theme.tint.${strength}`, section))

      const expected = tintNeutrals(original, strength)
      expect(harness.themeState.current.colors.slate).toEqual(expected.slate)
      expect(harness.themeState.current.colors.zinc).toEqual(expected.zinc)
      expect(harness.themeState.current.colors.slate['500']).not.toBe(
        '100 116 139',
      )
      expect(pressedStrengths(section)).toEqual(pressed)
    },
  )

  it('switching strengths tints from the colours before the first tint', async () => {
    await mountRedAccentTheme()
    const original = currentColorsCopy()
    const section = accentSection()

    click(buttonNamed('routes.theme.tint.strong', section))
    click(buttonNamed('routes.theme.tint.subtle', section))

    const subtleOnce = tintNeutrals(original, 'subtle')
    expect(harness.themeState.current.colors.slate).toEqual(subtleOnce.slate)
    expect(harness.themeState.current.colors.zinc).toEqual(subtleOnce.zinc)
  })

  it.each([
    ['primary', '100', '#00ff00'],
    ['zinc', '950', '#00ff00'],
  ])(
    'editing %s-%s after tinting clears the pressed strength and the next tint starts from the edit',
    async (category, shade, value) => {
      await mountRedAccentTheme()
      const section = accentSection()
      click(buttonNamed('routes.theme.tint.strong', section))

      harness.themeState.setColor(category, shade, value)
      harness.client.flushSync()

      expect(pressedStrengths(section)).toEqual(['false', 'false', 'false'])

      const edited = currentColorsCopy()
      click(buttonNamed('routes.theme.tint.subtle', section))

      const expected = tintNeutrals(edited, 'subtle')
      expect(harness.themeState.current.colors.slate).toEqual(expected.slate)
      expect(harness.themeState.current.colors.zinc).toEqual(expected.zinc)
    },
  )

  it('Reset puts slate and zinc back to the defaults and clears the pressed strength', async () => {
    await mountRedAccentTheme()
    const section = accentSection()
    click(buttonNamed('routes.theme.tint.strong', section))

    click(buttonNamed('routes.theme.tint.reset', section))

    const defaults = kelpColors()
    expect(harness.themeState.current.colors.slate).toEqual(defaults.slate)
    expect(harness.themeState.current.colors.zinc).toEqual(defaults.zinc)
    expect(harness.themeState.current.colors.primary).toEqual({
      '100': '241 245 249',
      '900': '220 38 38',
    })
    expect(harness.themeState.current.colors.other).toEqual({
      black: '0 0 0',
      white: '255 255 255',
    })
    expect(pressedStrengths(section)).toEqual(['false', 'false', 'false'])
  })

  it('Reset is disabled while the neutrals are the defaults and enabled after a tint', async () => {
    await mountRedAccentTheme()
    const section = accentSection()

    expect(buttonNamed('routes.theme.tint.reset', section).disabled).toBe(true)

    click(buttonNamed('routes.theme.tint.medium', section))

    expect(buttonNamed('routes.theme.tint.reset', section).disabled).toBe(false)
  })

  it('switching to another theme clears the pressed strength', async () => {
    await mountRedAccentTheme()
    click(buttonNamed('routes.theme.tint.strong', accentSection()))

    harness.themeState.data.currentTheme = 2
    harness.client.flushSync()
    expect(pressedStrengths(accentSection())).toEqual([
      'false',
      'false',
      'false',
    ])

    harness.themeState.data.currentTheme = 1
    harness.client.flushSync()
    expect(pressedStrengths(accentSection())).toEqual([
      'false',
      'false',
      'false',
    ])
  })
})
