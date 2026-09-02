import { redirect } from '@sveltejs/kit'

/**
 * Photon's multi-account switcher lived here. Coves runs one account per
 * browser, so the page is gone; bookmarks and old links land on login.
 */
export function load(): never {
  redirect(301, '/login')
}
