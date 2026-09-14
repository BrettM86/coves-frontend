// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))

async function svelteClientEntry(subpath: string): Promise<unknown> {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */
    require_.resolve('svelte/package.json').replace('package.json', subpath)
  )
}

vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))
vi.mock('svelte/reactivity', () =>
  svelteClientEntry('src/reactivity/index-client.js'),
)

interface ObserverRecord {
  callback: ResizeObserverCallback
  targets: Element[]
}

let resizeObservers: ObserverRecord[]

class MockResizeObserver implements ResizeObserver {
  #record: ObserverRecord

  constructor(callback: ResizeObserverCallback) {
    this.#record = { callback, targets: [] }
    resizeObservers.push(this.#record)
  }

  observe(target: Element): void {
    this.#record.targets.push(target)
  }
  unobserve(target: Element): void {
    this.#record.targets = this.#record.targets.filter(
      (candidate) => candidate !== target,
    )
  }
  disconnect(): void {
    this.#record.targets = []
  }
}

let client: typeof import('svelte')
let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeEach(async () => {
  client = await import('svelte')
  target = document.createElement('div')
  document.body.appendChild(target)
  resizeObservers = []
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      const index = Number(this.getAttribute('data-index'))
      const height = index === 0 ? 120 : index === 20 ? 80 : 100
      return {
        x: 0,
        y: 0,
        top: 0,
        right: 0,
        bottom: height,
        left: 0,
        width: 0,
        height,
        toJSON: () => ({}),
      }
    },
  )
})

afterEach(async () => {
  vi.useRealTimers()
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  vi.unstubAllGlobals()
})

async function mountList(
  items: number[],
  restore?: { itemHeights: (number | null)[] },
): Promise<HTMLElement> {
  const Subject = (await import('./VirtualListHeight.test.svelte')).default
  mounted = client.mount(Subject, {
    target,
    intro: false,
    props: { items, estimatedHeight: 100, restore },
  })
  client.flushSync()
  const list = target.querySelector<HTMLElement>('#feed')
  if (!list) throw new Error('VirtualList container did not mount')
  return list
}

describe('VirtualList container height', () => {
  it('exposes the full estimated and saved-height range before a deep scroll', async () => {
    const items = Array.from({ length: 50 }, (_, index) => index)
    const itemHeights = Array<number | null>(items.length).fill(null)
    itemHeights[0] = 120
    itemHeights[20] = 80

    const list = await mountList(items, { itemHeights })

    expect(list.style.height).toBe('5000px')
  })

  it('has zero height for an empty item array', async () => {
    const list = await mountList([])
    expect(list.style.height).toBe('0px')
  })

  it('uses border-box row measurements in the cumulative height', async () => {
    const list = await mountList([0, 1, 2])
    const observer = resizeObservers[0]
    const firstRow = observer?.targets.find(
      (element) => element.getAttribute('data-index') === '0',
    )
    if (!observer || !firstRow) throw new Error('First row was not observed')

    vi.useFakeTimers()
    observer.callback(
      [
        {
          target: firstRow,
          contentRect: { height: 90 },
          borderBoxSize: [{ blockSize: 120 }],
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    )
    await vi.runAllTimersAsync()
    client.flushSync()

    expect(list.style.height).toBe('320px')
  })

  it('retains the observer-time border-box height after the row detaches', async () => {
    const list = await mountList([0, 1, 2])
    const observer = resizeObservers[0]
    const firstRow = observer?.targets.find(
      (element) => element.getAttribute('data-index') === '0',
    )
    if (!observer || !firstRow) throw new Error('First row was not observed')

    vi.useFakeTimers()
    observer.callback(
      [
        {
          target: firstRow,
          contentRect: { height: 150 },
          borderBoxSize: [{ blockSize: 180 }],
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    )
    firstRow.remove()
    vi.spyOn(firstRow, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    })

    await vi.runAllTimersAsync()
    client.flushSync()

    expect(list.style.height).toBe('380px')
  })
})
