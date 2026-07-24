import { browser, building, dev } from '$app/environment'
import { env } from '$env/dynamic/public'
import { profile } from './auth.svelte'

class InstanceData {
  #instance = $derived(profile.current.instance)

  get data() {
    return this.#instance ?? DEFAULT_INSTANCE_URL
  }
}

export const instance = new InstanceData()

export const LINKED_INSTANCE_URL =
  (env.PUBLIC_LOCK_TO_INSTANCE ?? 'true').toLowerCase() == 'true'
    ? env.PUBLIC_INSTANCE_URL
    : undefined

const getDefaultInstance = (): string => {
  // The instance URL must never default to a third-party host. In production
  // the server fails fast when PUBLIC_INSTANCE_URL is missing — even if
  // PUBLIC_INTERNAL_INSTANCE is set, because the browser can only ever see
  // PUBLIC_INSTANCE_URL, so an internal-only config would leave every client
  // without an instance. In dev and in the browser we return '' instead of
  // throwing; server-side consumers (e.g. the API proxy) treat empty as a
  // hard config error. `building` is exempt: SvelteKit's postbuild analysis
  // imports this module inside the image build, where runtime env is
  // legitimately absent — the fail-fast belongs to server startup only.
  if (!browser && !building && !dev && !env.PUBLIC_INSTANCE_URL) {
    throw new Error(
      '[instance] PUBLIC_INSTANCE_URL is required in production. Set PUBLIC_INSTANCE_URL (PUBLIC_INTERNAL_INSTANCE is optional on top of it).',
    )
  }

  const configured = browser
    ? env.PUBLIC_INSTANCE_URL
    : env.PUBLIC_INTERNAL_INSTANCE || env.PUBLIC_INSTANCE_URL
  return configured || ''
}

export const DEFAULT_INSTANCE_URL = getDefaultInstance()
