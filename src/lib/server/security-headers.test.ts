import { describe, it, expect } from 'vitest'
import { EMBED_FRAME_ORIGINS } from '$lib/app/util/embed-hosts'
import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
  DENY_ALL_CSP,
  parseOriginList,
  type SecurityHeaderOptions,
} from './security-headers'

const prod: SecurityHeaderOptions = {
  dev: false,
  secure: true,
  instanceOrigin: 'https://coves.social',
  videoOrigins: parseOriginList('https://pds.coves.me https://tdpl.io'),
}

/** Splits a serialized policy into a `directive → sources` map. */
function directives(policy: string): Record<string, string> {
  return Object.fromEntries(
    policy
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...rest] = d.split(/\s+/)
        return [name, rest.join(' ')]
      }),
  )
}

describe('parseOriginList', () => {
  it('returns an empty list for unset or blank input', () => {
    expect(parseOriginList(undefined)).toEqual([])
    expect(parseOriginList('')).toEqual([])
    expect(parseOriginList('   ')).toEqual([])
  })

  it('accepts whitespace- or comma-separated https/http origins', () => {
    expect(
      parseOriginList(
        'https://img.coves.social, https://pds.coves.me http://a.test:8081',
      ),
    ).toEqual([
      'https://img.coves.social',
      'https://pds.coves.me',
      'http://a.test:8081',
    ])
  })

  it('normalises to the bare origin', () => {
    expect(
      parseOriginList(
        'https://img.coves.social/img/?x=1 HTTPS://User:pw@IMG.COVES.SOCIAL:443/ https://[::1]:8080/x',
      ),
    ).toEqual([
      'https://img.coves.social',
      'https://img.coves.social',
      'https://[::1]:8080',
    ])
  })

  it('rejects non-http schemes and unparseable entries loudly', () => {
    expect(() => parseOriginList('data:')).toThrow(/data:/)
    expect(() => parseOriginList('javascript:alert(1)')).toThrow(/javascript/)
    expect(() => parseOriginList('not a url')).toThrow(/not/)
  })

  it('rejects wildcards, with or without a scheme', () => {
    expect(() => parseOriginList('*.coves.social')).toThrow(/\*\.coves\.social/)
    expect(() => parseOriginList('https://*.coves.social')).toThrow(
      /single exact host/,
    )
  })

  it('rejects entries that WHATWG parsing would let serialise as extra directives', () => {
    // `;` and quotes are legal host code points, so new URL().origin keeps them.
    expect(() =>
      parseOriginList("https://a.test;script-src'unsafe-inline'"),
    ).toThrow(/single exact host/)
    expect(() => parseOriginList("https://a.test'")).toThrow(
      /single exact host/,
    )
  })

  it('strips anything after the host when the URL does parse', () => {
    expect(parseOriginList('https://a.test/;script-src')).toEqual([
      'https://a.test',
    ])
  })
})

describe('buildContentSecurityPolicy', () => {
  it('preserves the directives Kit already emitted (the nonce lives there)', () => {
    const existing = "script-src 'self' 'nonce-abc123'"
    const policy = directives(buildContentSecurityPolicy(existing, prod))
    expect(policy['script-src']).toBe("'self' 'nonce-abc123'")
  })

  it('emits a complete, fail-closed policy in production', () => {
    const policy = directives(
      buildContentSecurityPolicy("script-src 'self' 'nonce-x'", prod),
    )
    expect(policy['default-src']).toBe("'self'")
    expect(policy['base-uri']).toBe("'self'")
    expect(policy['object-src']).toBe("'none'")
    expect(policy['frame-ancestors']).toBe("'none'")
    expect(policy['form-action']).toBe("'self'")
    expect(policy['worker-src']).toBe("'self'")
    expect(policy['manifest-src']).toBe("'self'")
    expect(policy['font-src']).toBe("'self'")
    expect(policy['upgrade-insecure-requests']).toBe('')
  })

  it('does not add inline or eval to script-src', () => {
    const csp = buildContentSecurityPolicy("script-src 'self' 'nonce-x'", prod)
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(csp).not.toMatch(/'unsafe-eval'/)
  })

  it('keeps the SSR event-replay script-src-attr directive verbatim', () => {
    const policy = directives(
      buildContentSecurityPolicy(
        "script-src 'self' 'nonce-x'; script-src-attr 'unsafe-hashes' 'sha256-abc='",
        prod,
      ),
    )
    expect(policy['script-src']).toBe("'self' 'nonce-x'")
    expect(policy['script-src-attr']).toBe("'unsafe-hashes' 'sha256-abc='")
  })

  it('allows inline style attributes but not inline <style> elements in production', () => {
    const policy = directives(buildContentSecurityPolicy('', prod))
    expect(policy['style-src']).toBe("'self' 'unsafe-inline'")
    expect(policy['style-src-elem']).toBe("'self'")
    expect(policy['style-src-attr']).toBe("'unsafe-inline'")
  })

  it('opens style elements and HMR sockets only in dev', () => {
    const policy = directives(
      buildContentSecurityPolicy('', { ...prod, dev: true, secure: false }),
    )
    expect(policy['style-src-elem']).toBe("'self' 'unsafe-inline'")
    expect(policy['connect-src']).toContain('ws:')
    expect(policy['upgrade-insecure-requests']).toBeUndefined()
  })

  it('does not add upgrade-insecure-requests on plaintext deployments', () => {
    const policy = directives(
      buildContentSecurityPolicy('', { ...prod, secure: false }),
    )
    expect(policy['upgrade-insecure-requests']).toBeUndefined()
  })

  it('lets images load from self, inline data, any https host, and the instance origin', () => {
    const policy = directives(buildContentSecurityPolicy('', prod))
    expect(policy['img-src']).toBe(
      "'self' data: blob: https: https://coves.social",
    )
  })

  it('derives media-src from self, the instance origin and the configured video origins', () => {
    const policy = directives(buildContentSecurityPolicy('', prod))
    expect(policy['media-src']).toBe(
      "'self' blob: https://coves.social https://pds.coves.me https://tdpl.io",
    )
  })

  it('limits connect-src to self and the instance origin', () => {
    const policy = directives(buildContentSecurityPolicy('', prod))
    expect(policy['connect-src']).toBe("'self' https://coves.social")
  })

  it('limits frame-src to the fixed embed allowlist shared with PostIframe', () => {
    const policy = directives(buildContentSecurityPolicy('', prod))
    expect(policy['frame-src']).toBe(EMBED_FRAME_ORIGINS.join(' '))
    expect(policy['frame-src']).toBe(
      'https://www.youtube-nocookie.com https://yewtu.be https://piped.video https://streamable.com',
    )
  })

  it('fails closed when no instance or video origins are configured', () => {
    const policy = directives(
      buildContentSecurityPolicy('', {
        ...prod,
        instanceOrigin: null,
        videoOrigins: [],
      }),
    )
    expect(policy['img-src']).toBe("'self' data: blob: https:")
    expect(policy['media-src']).toBe("'self' blob:")
    expect(policy['connect-src']).toBe("'self'")
  })

  it('does not duplicate the instance origin when it is also a video origin', () => {
    const policy = directives(
      buildContentSecurityPolicy('', {
        ...prod,
        videoOrigins: ['https://coves.social', 'https://coves.social'],
      }),
    )
    expect(policy['media-src']).toBe("'self' blob: https://coves.social")
  })

  it('overrides every directive it owns, keeps unknown ones, drops empty segments', () => {
    const existing =
      "script-src 'self' 'nonce-x'; report-uri /csp; Default-Src 'none';  ; frame-src https://evil.test; sandbox"
    const out = buildContentSecurityPolicy(existing, prod)
    const policy = directives(out)
    expect(policy['script-src']).toBe("'self' 'nonce-x'")
    expect(policy['report-uri']).toBe('/csp')
    expect(policy['default-src']).toBe("'self'")
    expect(policy['Default-Src']).toBeUndefined()
    expect(policy['frame-src']).not.toContain('evil')
    expect(out).toContain('; sandbox')
    expect(out).not.toMatch(/;\s*;/)
  })

  it('does not duplicate directives if applied twice', () => {
    const once = buildContentSecurityPolicy("script-src 'self' 'nonce-x'", prod)
    const twice = buildContentSecurityPolicy(once, prod)
    expect(twice).toBe(once)
  })
})

describe('applySecurityHeaders', () => {
  function html(
    existingCsp?: string,
    type = 'text/html; charset=utf-8',
  ): Headers {
    const h = new Headers({ 'content-type': type })
    if (existingCsp) h.set('content-security-policy', existingCsp)
    return h
  }

  it('sets the transport-independent hardening headers on every response', () => {
    const headers = new Headers({ 'content-type': 'application/json' })
    applySecurityHeaders(headers, prod, false)
    expect(headers.get('x-content-type-options')).toBe('nosniff')
    expect(headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    )
    expect(headers.get('x-frame-options')).toBe('DENY')
    expect(headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(headers.get('permissions-policy')).toContain('camera=()')
    expect(headers.get('permissions-policy')).toContain('microphone=()')
    expect(headers.get('permissions-policy')).toContain('geolocation=()')
  })

  it('never restricts features the embed iframe delegates via allow=', () => {
    const headers = new Headers()
    applySecurityHeaders(headers, prod, false)
    const policy = headers.get('permissions-policy') ?? ''
    for (const feature of [
      'accelerometer',
      'autoplay',
      'clipboard-write',
      'encrypted-media',
      'gyroscope',
      'picture-in-picture',
      'web-share',
      'fullscreen',
    ]) {
      expect(policy).not.toContain(`${feature}=`)
    }
  })

  it('completes the CSP Kit emitted on a page Kit rendered', () => {
    const headers = html("script-src 'self' 'nonce-abc'")
    applySecurityHeaders(headers, prod, true)
    const policy = directives(headers.get('content-security-policy') ?? '')
    expect(policy['script-src']).toBe("'self' 'nonce-abc'")
    expect(policy['default-src']).toBe("'self'")
    expect(policy['media-src']).toContain('https://pds.coves.me')
  })

  it('denies all on a document the app did not render, even if it carries a permissive CSP', () => {
    // e.g. upstream HTML relayed by /api/proxy with its own header.
    const headers = html("script-src 'self' 'unsafe-inline'")
    applySecurityHeaders(headers, prod, false)
    expect(headers.get('content-security-policy')).toBe(DENY_ALL_CSP)
  })

  it('denies all on a document with no CSP that Kit did not render', () => {
    const headers = html()
    applySecurityHeaders(headers, prod, false)
    const policy = directives(headers.get('content-security-policy') ?? '')
    expect(policy['default-src']).toBe("'none'")
    expect(policy['frame-ancestors']).toBe("'none'")
    expect(policy['base-uri']).toBe("'none'")
    expect(policy['form-action']).toBe("'none'")
  })

  it('treats XHTML and upper-case content types as documents', () => {
    for (const type of ['application/xhtml+xml', 'TEXT/HTML']) {
      const headers = html(undefined, type)
      applySecurityHeaders(headers, prod, false)
      expect(headers.get('content-security-policy')).toBe(DENY_ALL_CSP)
    }
  })

  it('leaves CSP off non-document responses so worker and asset policies are untouched', () => {
    const headers = new Headers({ 'content-type': 'application/javascript' })
    applySecurityHeaders(headers, prod, true)
    expect(headers.get('content-security-policy')).toBeNull()
  })

  it('does not touch a CSP an endpoint set on a non-document response', () => {
    const headers = new Headers({
      'content-type': 'image/png',
      'content-security-policy': "default-src 'none'",
    })
    applySecurityHeaders(headers, prod, false)
    expect(headers.get('content-security-policy')).toBe("default-src 'none'")
  })
})
