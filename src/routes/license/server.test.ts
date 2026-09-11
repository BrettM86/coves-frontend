import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { RequestHandler } from '@sveltejs/kit'
import { createMockEvent } from '$lib/test-utils/request-event'

const endpoints = import.meta.glob<{ GET: RequestHandler }>('./+server.ts')

describe('public local licence', () => {
  it('serves the complete distributed licence and Photon attribution without authentication', async () => {
    const loadEndpoint = endpoints['./+server.ts']
    expect(
      loadEndpoint,
      '/license must expose a public HTTP endpoint',
    ).toBeTypeOf('function')
    if (!loadEndpoint) throw new Error('Missing /license endpoint')
    const { GET } = await loadEndpoint()
    const response = await GET(
      createMockEvent({ url: 'http://localhost/license' }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toMatch(/^text\/plain\b/)
    const body = await response.text()
    expect(body).toBe(readFileSync('LICENSE', 'utf8'))
    expect(body).toContain('GNU AFFERO GENERAL PUBLIC LICENSE')
    expect(body).toContain('13. Remote Network Interaction')
    expect(body).toContain('END OF TERMS AND CONDITIONS')
    expect(body).toMatch(/Photon/)
    expect(body).toMatch(/Copyright.*Xyphyn/i)
  })
})
