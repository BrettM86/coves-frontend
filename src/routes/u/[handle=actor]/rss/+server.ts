import { redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

/** The legacy profile path's feed, moved like `/u/<handle>` itself. */
export const GET: RequestHandler = ({ params, url }) => {
  redirect(
    301,
    `/profile/${encodeURIComponent(params.handle)}/rss${url.search}`,
  )
}
