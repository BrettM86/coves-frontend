/**
 * Instance URL constants derived purely from environment — a leaf module.
 *
 * This deliberately imports nothing from `auth.svelte` or `instance.svelte`.
 * `auth.svelte` needs `DEFAULT_INSTANCE_URL` to build the guest profile at
 * module scope, and `instance.svelte` needs `profile` from `auth.svelte`; if
 * these constants lived in `instance.svelte` that would be an import cycle,
 * and a page entering the cycle via `instance.svelte` would read the constant
 * before its declaration ran (a TDZ ReferenceError in unbundled dev, a silent
 * `undefined` in a bundled build). Keeping them here breaks the cycle.
 */
import { browser, building, dev } from '$app/environment'
import { env } from '$env/dynamic/public'
import {
  hasRequiredInstanceConfig,
  isLockedToInstance,
  MISSING_INSTANCE_MESSAGE,
  resolveInstanceUrl,
} from './resolve'

export const LINKED_INSTANCE_URL = isLockedToInstance(env)
  ? env.PUBLIC_INSTANCE_URL
  : undefined

const getDefaultInstance = (): string => {
  // The instance URL must never default to a third-party host. In production
  // the server fails fast when PUBLIC_INSTANCE_URL is missing — even if
  // PUBLIC_INTERNAL_INSTANCE is set, because the browser can only ever see
  // PUBLIC_INSTANCE_URL, so an internal-only config would leave every client
  // without an instance. In dev and in the browser we return '' instead of
  // throwing; server-side consumers (hooks, the API proxy) treat empty as a
  // hard config error. `building` is exempt: SvelteKit's postbuild analysis
  // imports this module inside the image build, where runtime env is
  // legitimately absent — the fail-fast belongs to server startup only.
  if (!browser && !building && !dev && !hasRequiredInstanceConfig(env)) {
    throw new Error(`[instance] ${MISSING_INSTANCE_MESSAGE}`)
  }
  return resolveInstanceUrl(env, browser ? 'browser' : 'server')
}

export const DEFAULT_INSTANCE_URL = getDefaultInstance()
