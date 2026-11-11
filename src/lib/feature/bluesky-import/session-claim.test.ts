/**
 * The automatic offer checks at most once per browser tab session per DID.
 * sessionStorage carries the claim across reloads; when the browser refuses
 * storage, memory still gates repeat claims in the same page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ALICE = 'did:plc:alice'
const BOB = 'did:plc:bob'

/** An in-memory Storage, standing in for the browser's in the node env. */
function memoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => {
      entries.delete(key)
    },
    setItem: (key: string, value: string) => {
      entries.set(key, String(value))
    },
  }
}

/** A fresh copy of the module, as after a page reload. */
async function freshModule() {
  vi.resetModules()
  return import('./session-claim')
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('claimAutomaticCheck', () => {
  it('claims once per DID: first true, repeat false, another DID true', async () => {
    const { claimAutomaticCheck } = await freshModule()
    expect(claimAutomaticCheck(ALICE)).toBe(true)
    expect(claimAutomaticCheck(ALICE)).toBe(false)
    expect(claimAutomaticCheck(BOB)).toBe(true)
  })

  it('remembers the claim in sessionStorage across a module reload', async () => {
    const first = await freshModule()
    expect(first.claimAutomaticCheck(ALICE)).toBe(true)

    const reloaded = await freshModule()
    expect(reloaded.claimAutomaticCheck(ALICE)).toBe(false)
    expect(reloaded.claimAutomaticCheck(BOB)).toBe(true)
  })

  it('still gates repeat claims in memory when sessionStorage reads throw', async () => {
    const storage = memoryStorage()
    storage.getItem = () => {
      throw new DOMException('denied', 'SecurityError')
    }
    vi.stubGlobal('sessionStorage', storage)
    const { claimAutomaticCheck } = await freshModule()
    expect(claimAutomaticCheck(ALICE)).toBe(true)
    expect(claimAutomaticCheck(ALICE)).toBe(false)
    expect(claimAutomaticCheck(BOB)).toBe(true)
  })

  it('still gates repeat claims in memory when sessionStorage writes throw', async () => {
    const storage = memoryStorage()
    storage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError')
    }
    vi.stubGlobal('sessionStorage', storage)
    const { claimAutomaticCheck } = await freshModule()
    expect(claimAutomaticCheck(ALICE)).toBe(true)
    expect(claimAutomaticCheck(ALICE)).toBe(false)
    expect(claimAutomaticCheck(BOB)).toBe(true)
  })
})
