/**
 * The root server load: Accept-Language negotiation and session passthrough.
 *
 * This load runs once per request in a process shared by every request, so the
 * language it resolves has to travel on the request (`locals.lang`) rather than
 * by pointing a module-level store at it. The tests below pin both halves: the
 * negotiation result, and the absence of any global mutation.
 *
 * `$lib/app/state/i18n` is mocked only to record calls — `loadTranslations`
 * still delegates to the real implementation, and `locales`/`aliases` are the
 * real ones, so the negotiation cases exercise the genuine locale list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  loadTranslations: [] as string[],
  localeSet: [] as string[],
}))

vi.mock('$lib/app/state/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/app/state/i18n')>()
  return {
    ...actual,
    loadTranslations: async (locale: string): Promise<void> => {
      calls.loadTranslations.push(locale)
      await actual.loadTranslations(locale)
    },
    locale: {
      subscribe: actual.locale.subscribe,
      set: (value: string): void => {
        calls.localeSet.push(value)
      },
    },
  }
})

const { load } = await import('./+layout.server')

interface CallOptions {
  readonly header?: string
  readonly authenticated?: boolean
}

const ACCOUNT = {
  did: 'did:plc:abcdefghijklmnopqrstuvwx',
  handle: 'mari.test',
  instance: 'http://127.0.0.1:8081',
  sealedToken: 'sealed-token',
  avatar: undefined,
}

function makeEvent({ header, authenticated = false }: CallOptions) {
  const headers: Record<string, string> = {}
  if (header !== undefined) headers['Accept-Language'] = header
  return {
    depends: vi.fn(),
    request: new Request('http://localhost/', { headers }),
    locals: {
      auth: authenticated
        ? { authenticated: true, account: ACCOUNT, authToken: 'sealed-token' }
        : { authenticated: false },
    },
  }
}

async function callLoad(options: CallOptions = {}) {
  const event = makeEvent(options)
  const data = await load(event as unknown as Parameters<typeof load>[0])
  return { data: data as { lang: string; session: unknown }, event }
}

const langFor = async (header?: string): Promise<string> =>
  (await callLoad({ header })).data.lang

beforeEach(() => {
  calls.loadTranslations.length = 0
  calls.localeSet.length = 0
})

describe('root server load — language negotiation', () => {
  it('resolves a plain tag the app ships a dictionary for', async () => {
    expect(await langFor('de')).toBe('de')
  })

  it('resolves a regional tag through the alias map', async () => {
    expect(await langFor('de-DE')).toBe('de')
    expect(await langFor('zh-CN')).toBe('zh-Hans')
    expect(await langFor('zh-TW')).toBe('zh-Hant')
  })

  it('falls back to en for an unknown tag and for no header at all', async () => {
    expect(await langFor('xx')).toBe('en')
    expect(await langFor(undefined)).toBe('en')
  })

  it('prefers the highest-priority entry the app can serve', async () => {
    // The loop walks the header reversed and overwrites on every match, so the
    // EARLIEST matching entry is the one left standing — which is the entry
    // the client ranked highest.
    expect(await langFor('fr,de;q=0.8')).toBe('fr')
    expect(await langFor('de,fr;q=0.8')).toBe('de')
    // Skips entries it cannot serve rather than giving up at the first one.
    expect(await langFor('xx,de')).toBe('de')
  })

  describe('characterizations — current behaviour, not necessarily desired', () => {
    it('maps pt-BR to pt even though pt-BR is itself a shipped locale', async () => {
      // The alias lookup is consulted before the availability check is used to
      // pick a value, and `aliases` maps pt-BR -> pt, so a Brazilian client
      // never receives pt-BR.json.
      expect(await langFor('pt-BR')).toBe('pt')
    })

    it('ignores any entry that follows a space after the comma', async () => {
      // Entries are split on ',' and never trimmed, so " de" matches nothing.
      // Clients that pad their Accept-Language lose every entry but the first.
      expect(await langFor('xx, de')).toBe('en')
      expect(await langFor('xx,de')).toBe('de')
    })

    it('matches tags case-sensitively', async () => {
      expect(await langFor('DE')).toBe('en')
      expect(await langFor('de')).toBe('de')
    })
  })
})

describe('root server load — the language travels on the request', () => {
  it('stamps the resolved language onto locals', async () => {
    const { event } = await callLoad({ header: 'de' })

    // The contract that makes per-request rendering possible: universal code
    // reads `locals.lang` through the request-event accessor rather than a
    // module-level store.
    expect((event.locals as { lang?: string }).lang).toBe('de')
  })

  it('stamps the fallback language when nothing matched', async () => {
    const { event } = await callLoad({ header: 'xx' })

    expect((event.locals as { lang?: string }).lang).toBe('en')
  })

  it('resolves each request independently of the one before it', async () => {
    // No memo, no "last resolved language" carried between calls: a request
    // the app cannot serve must land on en even when the previous one
    // resolved to something else.
    expect(await langFor('de')).toBe('de')
    expect(await langFor('fr')).toBe('fr')
    expect(await langFor('xx')).toBe('en')
  })

  it('never calls locale.set', async () => {
    // Regression guard. The load may preload a dictionary; it may not point
    // the shared locale at this request's language.
    await callLoad({ header: 'de' })

    expect(calls.localeSet).toEqual([])
    // Preloading IS allowed, and is how the render stays synchronous.
    expect(calls.loadTranslations).toEqual(['de'])
  })
})

describe('root server load — session passthrough', () => {
  it('returns a client session for an authenticated request', async () => {
    const { data } = await callLoad({ authenticated: true })

    expect(data.session).toMatchObject({
      authenticated: true,
      account: { handle: 'mari.test', did: ACCOUNT.did },
    })
    // The sealed token must never reach the client.
    expect(JSON.stringify(data.session)).not.toContain('sealed-token')
  })

  it('returns a null session for an anonymous request', async () => {
    const { data } = await callLoad({ authenticated: false })

    expect(data.session).toBeNull()
  })
})

describe('root server load — session generation', () => {
  it.each([true, false])(
    'forwards the validated request generation even when authenticated is %s',
    async (authenticated) => {
      const event = makeEvent({ authenticated })
      Object.assign(event.locals, {
        sessionGeneration: 'opaque-session-generation',
        sessionExpired: !authenticated,
      })
      const data = await load(event as unknown as Parameters<typeof load>[0])
      expect(data).toMatchObject({
        sessionGeneration: 'opaque-session-generation',
        sessionExpired: !authenticated,
      })
      if (authenticated)
        expect(data.session).toMatchObject({
          sessionGeneration: 'opaque-session-generation',
        })
      expect(JSON.stringify(data)).not.toContain('sealed-token')
    },
  )
})

describe('root server load — explicit session refresh dependency', () => {
  it('declares the dependency recovery invalidates without navigating away from a draft', async () => {
    const { event } = await callLoad()
    expect(event.depends).toHaveBeenCalledWith('app:session')
  })
})
