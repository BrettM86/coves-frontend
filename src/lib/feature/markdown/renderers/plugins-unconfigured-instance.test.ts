import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// localizeLink() - default origin when the instance is not configured
//
// Called with no second argument, localizeLink takes the instance origin from
// PUBLIC_INSTANCE_URL. When that is unset or unparseable there is no own
// instance, so no profile link localizes — not even one to the public
// production host, the local-dev web origin or the Vite dev server. There is
// no hardcoded fallback host, and PUBLIC_INSTANCE_DOMAIN (the community
// domain) never stands in for the web origin.
// ---------------------------------------------------------------------------

/** Load plugins against a fresh module graph with this public env. */
async function importPluginsWith(env: Record<string, string>) {
  vi.resetModules()
  vi.doMock('$env/dynamic/public', () => ({ env }))
  return await import('./plugins')
}

const UNCONFIGURED_ENVS: { name: string; env: Record<string, string> }[] = [
  { name: 'nothing is set', env: {} },
  {
    name: 'PUBLIC_INSTANCE_URL is http://',
    env: {
      PUBLIC_INSTANCE_URL: 'http://',
      PUBLIC_INSTANCE_DOMAIN: 'coves.social',
    },
  },
  {
    name: 'PUBLIC_INSTANCE_URL is ::',
    env: {
      PUBLIC_INSTANCE_URL: '::',
      PUBLIC_INSTANCE_DOMAIN: 'coves.social',
    },
  },
]

const PROFILE_LINKS = [
  'https://coves.social/profile/alice.bsky.social',
  'https://coves.social/u/did:plc:abc123',
  'http://127.0.0.1:8080/profile/alice.bsky.social',
  'http://localhost:5173/profile/alice.bsky.social',
]

describe.each(UNCONFIGURED_ENVS)(
  'localizeLink - default origin when $name',
  ({ env }) => {
    it.each(PROFILE_LINKS)('leaves %s external', async (link) => {
      const { localizeLink } = await importPluginsWith(env)
      expect(localizeLink(link)).toBeUndefined()
    })

    it('still localizes a community link', async () => {
      const { localizeLink } = await importPluginsWith(env)
      expect(localizeLink('https://lemmy.world/c/my-community')).toBe(
        '/c/my-community@lemmy.world',
      )
    })
  },
)

// Control: the same harness with a configured instance does localize, so the
// cases above pass because of the env, not because the mock never applied.
describe('localizeLink - default origin when PUBLIC_INSTANCE_URL is configured', () => {
  it('localizes a profile link on the configured origin', async () => {
    const { localizeLink } = await importPluginsWith({
      PUBLIC_INSTANCE_URL: 'https://coves.social',
    })
    expect(localizeLink('https://coves.social/profile/alice.bsky.social')).toBe(
      '/profile/alice.bsky.social',
    )
  })
})
