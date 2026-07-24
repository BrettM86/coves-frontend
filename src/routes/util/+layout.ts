import { dev } from '$app/environment'
import { error } from '@sveltejs/kit'
import type { LayoutLoad } from './$types'

// The /util/* pages are developer debug tools (instance inspector, placeholder
// gallery, constants dump). The nav link is already gated, but the routes were
// still directly reachable in production — 404 them outside dev builds.
export const load: LayoutLoad = () => {
  if (!dev) {
    error(404, 'Not found')
  }
}
