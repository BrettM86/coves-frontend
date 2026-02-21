import { redirect } from '@sveltejs/kit'

export function load({ params, url }) {
  redirect(301, `/profile/${encodeURIComponent(params.handle)}${url.search}`)
}
