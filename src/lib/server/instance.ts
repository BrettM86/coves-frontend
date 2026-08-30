/**
 * Server-side instance resolution, bound to the real runtime env.
 *
 * This is the only module that reads `$env/dynamic/private`; every rule lives
 * in `$lib/app/state/instance/resolve` so browser and server agree on precedence.
 */
import { env as privateEnv } from '$env/dynamic/private'
import { env as publicEnv } from '$env/dynamic/public'
import {
  addressHeaderWarning,
  canonicalPublicHost,
  isUpstreamSchemeAllowed,
  lockedInstanceOrigin,
  MISSING_INSTANCE_MESSAGE,
  originWarning,
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

/**
 * The boot-time `ADDRESS_HEADER` warning for this deployment, or null.
 *
 * `import.meta.env.PROD` rather than `!dev` so the warning is tied to the build
 * mode, and never fires under test.
 */
export function addressHeaderConfigWarning(): string | null {
  return addressHeaderWarning(
    { ADDRESS_HEADER: privateEnv.ADDRESS_HEADER },
    import.meta.env.PROD,
  )
}

/**
 * The boot-time `ORIGIN` error for this deployment, or null.
 *
 * Same build-mode gate as `addressHeaderConfigWarning`: `import.meta.env.PROD`
 * so it never fires under test or dev.
 */
export function originConfigWarning(): string | null {
  return originWarning({ ORIGIN: privateEnv.ORIGIN }, import.meta.env.PROD)
}

/**
 * When `PUBLIC_LOCK_TO_INSTANCE` is on, the sole origin login may target;
 * null when unlocked or unconfigured. The login UI hides the instance field
 * under the same flag — this is the server-side half of that policy.
 */
export function loginLockedOrigin(): string | null {
  return lockedInstanceOrigin(publicEnv)
}

/** Applies the `ALLOW_HTTP_INTERNAL_INSTANCE` plaintext policy to a target URL. */
export function upstreamSchemeAllowed(target: string): boolean {
  return isUpstreamSchemeAllowed(target, {
    PUBLIC_INTERNAL_INSTANCE: publicEnv.PUBLIC_INTERNAL_INSTANCE,
    ALLOW_HTTP_INTERNAL_INSTANCE: privateEnv.ALLOW_HTTP_INTERNAL_INSTANCE,
  })
}
