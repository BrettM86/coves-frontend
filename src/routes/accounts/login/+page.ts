import { redirect } from '@sveltejs/kit'

/** The login form used to be mounted under the accounts switcher as well. */
export function load(): never {
  redirect(301, '/login')
}
