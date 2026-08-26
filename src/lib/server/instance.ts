/**
 * Server-side instance resolution, bound to the real runtime env.
 *
 * This is the only module that reads `$env/dynamic/private`; every rule lives
 * in `$lib/app/state/instance/resolve` so browser and server agree on precedence.
 */
import { env as privateEnv } from '$env/dynamic/private'
import { env as publicEnv } from '$env/dynamic/public'
import {
  canonicalPublicHost,
  isUpstreamSchemeAllowed,
  MISSING_INSTANCE_MESSAGE,
  resolveInstanceUrl,
} from '$lib/app/state/instance/resolve'

/**
 * The backend URL server-side code should talk to
 * (`PUBLIC_INTERNAL_INSTANCE`, else `PUBLIC_INSTANCE_URL`).
 * Throws when neither is configured — misconfiguration must surface, not
 * silently produce relative fetches.
 */
export function upstreamInstanceUrl(): string {
  const url = resolveInstanceUrl(publicEnv, 'server')
  if (!url) throw new Error(`[instance] ${MISSING_INSTANCE_MESSAGE}`)
  return url
}

/** `PUBLIC_INSTANCE_URL`'s host, for the dev-mode localhost → 127.0.0.1 redirect. */
export function canonicalHost(): string | null {
  return canonicalPublicHost(publicEnv)
}

/** `PUBLIC_INSTANCE_URL` as an absolute URL, or null when unset/invalid. */
export function publicInstanceUrl(): URL | null {
  try {
    return publicEnv.PUBLIC_INSTANCE_URL
      ? new URL(publicEnv.PUBLIC_INSTANCE_URL)
      : null
  } catch {
    return null
  }
}

/** Applies the `ALLOW_HTTP_INTERNAL_INSTANCE` plaintext policy to a target URL. */
export function upstreamSchemeAllowed(target: string): boolean {
  return isUpstreamSchemeAllowed(target, {
    PUBLIC_INTERNAL_INSTANCE: publicEnv.PUBLIC_INTERNAL_INSTANCE,
    ALLOW_HTTP_INTERNAL_INSTANCE: privateEnv.ALLOW_HTTP_INTERNAL_INSTANCE,
  })
}
