import { describe, expect, it } from 'vitest'
import {
  addressHeaderWarning,
  canonicalPublicHost,
  hasRequiredInstanceConfig,
  instanceOrigin,
  isLockedToInstance,
  isUpstreamSchemeAllowed,
  localInstanceDomain,
  lockedInstanceOrigin,
  normalizeInstanceUrl,
  resolveInstanceUrl,
} from './resolve'

const BOTH = {
  PUBLIC_INSTANCE_URL: 'https://coves.social',
  PUBLIC_INTERNAL_INSTANCE: 'http://appview:8080',
}

describe('resolveInstanceUrl', () => {
  it('browser only ever sees PUBLIC_INSTANCE_URL', () => {
    expect(resolveInstanceUrl(BOTH, 'browser')).toBe('https://coves.social')
  })

  it('server prefers PUBLIC_INTERNAL_INSTANCE', () => {
    expect(resolveInstanceUrl(BOTH, 'server')).toBe('http://appview:8080')
  })

  it('server falls back to PUBLIC_INSTANCE_URL', () => {
    expect(
      resolveInstanceUrl({ PUBLIC_INSTANCE_URL: 'https://a.b' }, 'server'),
    ).toBe('https://a.b')
  })

  it('returns empty string when nothing is configured', () => {
    expect(resolveInstanceUrl({}, 'server')).toBe('')
    expect(resolveInstanceUrl({}, 'browser')).toBe('')
  })

  it('treats empty-string env as unset', () => {
    expect(
      resolveInstanceUrl(
        { PUBLIC_INTERNAL_INSTANCE: '', PUBLIC_INSTANCE_URL: 'https://a.b' },
        'server',
      ),
    ).toBe('https://a.b')
  })
})

describe('hasRequiredInstanceConfig', () => {
  it('requires the public URL even when the internal one is set', () => {
    expect(hasRequiredInstanceConfig(BOTH)).toBe(true)
    expect(
      hasRequiredInstanceConfig({ PUBLIC_INTERNAL_INSTANCE: 'http://x' }),
    ).toBe(false)
  })
})

describe('normalizeInstanceUrl', () => {
  it('adds https:// to a bare host', () => {
    expect(normalizeInstanceUrl('coves.social')).toBe('https://coves.social')
  })

  it('keeps an explicit http:// scheme', () => {
    expect(normalizeInstanceUrl('http://127.0.0.1:8081')).toBe(
      'http://127.0.0.1:8081',
    )
  })

  it('preserves a path prefix', () => {
    expect(normalizeInstanceUrl('coves.social/api')).toBe(
      'https://coves.social/api',
    )
  })

  it('trims whitespace', () => {
    expect(normalizeInstanceUrl('  coves.social ')).toBe('https://coves.social')
  })

  it('returns null for empty or unparseable input', () => {
    expect(normalizeInstanceUrl(undefined)).toBeNull()
    expect(normalizeInstanceUrl('')).toBeNull()
    expect(normalizeInstanceUrl('   ')).toBeNull()
    expect(normalizeInstanceUrl('http://')).toBeNull()
  })
})

describe('instanceOrigin', () => {
  it('strips paths and defaults the scheme', () => {
    expect(instanceOrigin('coves.social/x')).toBe('https://coves.social')
    expect(instanceOrigin('http://appview:8080/')).toBe('http://appview:8080')
    expect(instanceOrigin(undefined)).toBeNull()
  })
})

describe('canonicalPublicHost', () => {
  it('returns host with port', () => {
    expect(
      canonicalPublicHost({ PUBLIC_INSTANCE_URL: 'http://127.0.0.1:8080' }),
    ).toBe('127.0.0.1:8080')
  })

  it('returns null when unset or invalid', () => {
    expect(canonicalPublicHost({})).toBeNull()
    expect(canonicalPublicHost({ PUBLIC_INSTANCE_URL: 'nope' })).toBeNull()
  })
})

describe('isUpstreamSchemeAllowed', () => {
  it('always allows https', () => {
    expect(isUpstreamSchemeAllowed('https://anything', {})).toBe(true)
  })

  it('rejects http without the opt-in', () => {
    expect(isUpstreamSchemeAllowed('http://appview:8080', BOTH)).toBe(false)
  })

  it('allows http only for the configured internal origin', () => {
    const env = { ...BOTH, ALLOW_HTTP_INTERNAL_INSTANCE: 'true' }
    expect(isUpstreamSchemeAllowed('http://appview:8080', env)).toBe(true)
    expect(isUpstreamSchemeAllowed('http://appview:8080/xrpc', env)).toBe(true)
    expect(isUpstreamSchemeAllowed('http://evil:8080', env)).toBe(false)
  })

  it('rejects http when the internal instance has no http scheme', () => {
    const env = {
      PUBLIC_INTERNAL_INSTANCE: 'appview:8080',
      ALLOW_HTTP_INTERNAL_INSTANCE: 'true',
    }
    expect(isUpstreamSchemeAllowed('http://appview:8080', env)).toBe(false)
  })
})

describe('addressHeaderWarning', () => {
  // Behind a reverse proxy, adapter-node reports the proxy's own address as
  // the client address unless ADDRESS_HEADER names the header carrying the
  // real one. Every request then looks like it came from one IP, so anything
  // the backend does per-address — rate limiting above all — collapses onto a
  // single bucket. It is silent and only matters in production, so the boot
  // sequence has to say it out loud.
  it('says nothing outside production', () => {
    expect(addressHeaderWarning({}, false)).toBeNull()
    expect(addressHeaderWarning({ ADDRESS_HEADER: '' }, false)).toBeNull()
  })

  it('says nothing when the header is configured', () => {
    expect(
      addressHeaderWarning({ ADDRESS_HEADER: 'x-real-ip' }, true),
    ).toBeNull()
  })

  it('warns in production when the header is unset or empty', () => {
    for (const env of [{}, { ADDRESS_HEADER: '' }]) {
      const warning = addressHeaderWarning(env, true)
      expect(warning).not.toBeNull()
      expect(warning).toContain('ADDRESS_HEADER')
      expect(warning).toContain('rate')
    }
  })
})

describe('isLockedToInstance', () => {
  it('defaults to locked when unset', () => {
    expect(isLockedToInstance({})).toBe(true)
  })

  it('only the literal "false" unlocks, case-insensitively', () => {
    expect(isLockedToInstance({ PUBLIC_LOCK_TO_INSTANCE: 'false' })).toBe(false)
    expect(isLockedToInstance({ PUBLIC_LOCK_TO_INSTANCE: 'FALSE' })).toBe(false)
    expect(isLockedToInstance({ PUBLIC_LOCK_TO_INSTANCE: 'true' })).toBe(true)
    expect(isLockedToInstance({ PUBLIC_LOCK_TO_INSTANCE: 'no' })).toBe(false)
  })
})

describe('lockedInstanceOrigin', () => {
  it('returns the public origin when locked', () => {
    expect(lockedInstanceOrigin(BOTH)).toBe('https://coves.social')
  })

  it('normalises a bare host and drops any path', () => {
    expect(
      lockedInstanceOrigin({ PUBLIC_INSTANCE_URL: 'coves.social/app' }),
    ).toBe('https://coves.social')
  })

  it('returns null when unlocked', () => {
    expect(
      lockedInstanceOrigin({ ...BOTH, PUBLIC_LOCK_TO_INSTANCE: 'false' }),
    ).toBeNull()
  })

  it('returns null when there is nothing to pin to', () => {
    expect(lockedInstanceOrigin({})).toBeNull()
    expect(lockedInstanceOrigin({ PUBLIC_INSTANCE_URL: '::' })).toBeNull()
  })
})

describe('localInstanceDomain', () => {
  it('derives the hostname of PUBLIC_INSTANCE_URL', () => {
    expect(localInstanceDomain(BOTH)).toBe('coves.social')
  })

  it('reduces an explicit domain written as a URL to its hostname', () => {
    expect(
      localInstanceDomain({
        ...BOTH,
        PUBLIC_INSTANCE_DOMAIN: 'https://Coves.Social:8443/',
      }),
    ).toBe('coves.social')
  })

  it('drops scheme, port and path', () => {
    expect(
      localInstanceDomain({
        PUBLIC_INSTANCE_URL: 'http://Coves.Social:8080/x',
      }),
    ).toBe('coves.social')
  })

  it('accepts a bare host', () => {
    expect(localInstanceDomain({ PUBLIC_INSTANCE_URL: 'coves.social' })).toBe(
      'coves.social',
    )
  })

  it('prefers an explicit PUBLIC_INSTANCE_DOMAIN, lower-cased', () => {
    expect(
      localInstanceDomain({
        PUBLIC_INSTANCE_URL: 'http://127.0.0.1:8080',
        PUBLIC_INSTANCE_DOMAIN: ' Coves.Local ',
      }),
    ).toBe('coves.local')
  })

  it('ignores a blank override', () => {
    expect(localInstanceDomain({ ...BOTH, PUBLIC_INSTANCE_DOMAIN: '  ' })).toBe(
      'coves.social',
    )
  })

  it('returns null when nothing is configured or the URL is invalid', () => {
    expect(localInstanceDomain({})).toBeNull()
    expect(localInstanceDomain({ PUBLIC_INSTANCE_URL: '::' })).toBeNull()
  })
})
