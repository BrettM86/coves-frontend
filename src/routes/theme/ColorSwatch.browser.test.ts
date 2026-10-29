// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$lib/app/state/i18n', () => {
  const translate = (key: string) => key
  return {
    t: {
      get: translate,
      subscribe: (run: (translator: typeof translate) => void) => {
        run(translate)
        return () => {}
      },
    },
  }
})

const svelteClientEntry = async (subpath: string): Promise<unknown> => {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */ require_
      .resolve('svelte/package.json')
      .replace('package.json', subpath)
  )
}
vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))
vi.mock('svelte/reactivity', () =>
  svelteClientEntry('src/reactivity/index-client.js'),
)

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')

beforeEach(async () => {
  client = await import('svelte')
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
})

async function mountSwatch(props: {
  value: string
  label: string
  onchange: (rgb: string) => void
  onreset?: () => void
  readonly?: boolean
}) {
  const ColorSwatch = (await import('./ColorSwatch.svelte')).default
  mounted = client.mount(ColorSwatch, { target, intro: false, props })
  client.flushSync()
}

function colorInput(): HTMLInputElement {
  const input = target.querySelector<HTMLInputElement>('input[type="color"]')
  if (!input) throw new Error('Missing colour input')
  return input
}

function hexField(): HTMLInputElement {
  const input = target.querySelector<HTMLInputElement>('input[type="text"]')
  if (!input) throw new Error('Missing hex text field')
  return input
}

function accessibleName(element: HTMLElement): string {
  const ariaLabel = element.getAttribute('aria-label')
  if (ariaLabel) return ariaLabel
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) {
    return labelledBy
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
  }
  const labels =
    element instanceof HTMLInputElement ? [...(element.labels ?? [])] : []
  if (labels.length > 0)
    return labels.map((label) => label.textContent?.trim() ?? '').join(' ')
  return element.textContent?.trim() ?? ''
}

function typeInto(input: HTMLInputElement, value: string, event: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  if (event !== 'input')
    input.dispatchEvent(new Event(event, { bubbles: true }))
  client.flushSync()
}

describe('ColorSwatch', () => {
  it('shows the stored rgb triple as a hex colour in the picker', async () => {
    await mountSwatch({
      value: '15 23 42',
      label: 'Zinc 900',
      onchange: vi.fn(),
    })

    expect(colorInput().value).toBe('#0f172a')
  })

  it('reports picker input as an rgb triple, never hex', async () => {
    const onchange = vi.fn()
    await mountSwatch({ value: '15 23 42', label: 'Zinc 900', onchange })

    typeInto(colorInput(), '#ff0000', 'input')

    expect(onchange).toHaveBeenCalledWith('255 0 0')
    for (const [value] of onchange.mock.calls) {
      expect(String(value).startsWith('#')).toBe(false)
    }
  })

  it('names the colour input after its label', async () => {
    await mountSwatch({
      value: '15 23 42',
      label: 'Zinc 900',
      onchange: vi.fn(),
    })

    expect(accessibleName(colorInput())).toBe('Zinc 900')
  })

  it('has a visible reset button that calls onreset', async () => {
    const onreset = vi.fn()
    await mountSwatch({
      value: '15 23 42',
      label: 'Zinc 900',
      onchange: vi.fn(),
      onreset,
    })

    const reset = [...target.querySelectorAll<HTMLElement>('button')].find(
      (button) => {
        const name = accessibleName(button)
        return name.includes('Zinc 900') || name.includes('settings.reset')
      },
    )
    expect(reset).toBeDefined()
    expect(reset?.hidden).toBe(false)
    reset?.click()
    client.flushSync()

    expect(onreset).toHaveBeenCalled()
  })

  describe('read-only', () => {
    it('shows the colour as selectable read-only hex, disables the picker and offers no reset', async () => {
      await mountSwatch({
        value: '18 18 21',
        label: 'Zinc 900',
        onchange: vi.fn(),
        onreset: vi.fn(),
        readonly: true,
      })

      expect(hexField().value).toBe('#121215')
      expect(hexField().readOnly).toBe(true)
      expect(hexField().disabled).toBe(false)
      expect(colorInput().disabled).toBe(true)
      expect(target.querySelectorAll('button')).toHaveLength(0)
    })

    it('ignores the right-click reset shortcut', async () => {
      const onreset = vi.fn()
      await mountSwatch({
        value: '18 18 21',
        label: 'Zinc 900',
        onchange: vi.fn(),
        onreset,
        readonly: true,
      })

      colorInput().dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      )
      client.flushSync()

      expect(onreset).not.toHaveBeenCalled()
    })
  })

  describe('hex text field', () => {
    it('shows the current colour as hex', async () => {
      await mountSwatch({
        value: '15 23 42',
        label: 'Zinc 900',
        onchange: vi.fn(),
      })

      expect(hexField().value).toBe('#0f172a')
    })

    it('commits a typed hex colour as an rgb triple', async () => {
      const onchange = vi.fn()
      await mountSwatch({ value: '15 23 42', label: 'Zinc 900', onchange })

      typeInto(hexField(), '#00ff00', 'change')

      expect(onchange).toHaveBeenCalledWith('0 255 0')
    })

    it('rejects invalid text and restores the current colour', async () => {
      const onchange = vi.fn()
      await mountSwatch({ value: '15 23 42', label: 'Zinc 900', onchange })

      typeInto(hexField(), 'nope', 'change')

      expect(onchange).not.toHaveBeenCalled()
      expect(hexField().value).toBe('#0f172a')
    })
  })
})
