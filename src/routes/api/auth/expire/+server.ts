import type { RequestHandler } from './$types'
import { validateRequestOrigin } from '$lib/server/csrf'
import { log } from '$lib/server/log'
import { sessionGenerationOf } from '$lib/server/session'

/**
 * POST /api/auth/expire
 *
 * Clears a session cookie the client has learned is dead. Body:
 * `{ generation: string }`, the digest the page was rendered under.
 *
 * - 204: the cookie matched and was deleted, or there was no cookie.
 * - 409: a different cookie is present — a newer login owns it. Left alone.
 * - 400: missing or malformed body.
 * - 403: cross-origin request.
 *
 * Never calls the backend logout: that would revoke whatever cookie is
 * present, including a replacement the reporting page has not seen yet.
 *
 * Residual race: the comparison below sees the cookie the request carried,
 * not the one in the browser when the Set-Cookie deletion lands. A login in
 * another tab that completes in between loses its cookie. `hooks.server.ts`
 * skips the /api/me check for this route so that window is the request's own
 * round trip (milliseconds), and the client only sends from a visible tab,
 * aborts once it adopts a newer login, and revalidates the session after a
 * 204 that arrived under a changed generation, so the loss is noticed at once.
 */
export const POST: RequestHandler = async ({
  request,
  cookies,
  locals,
  url,
}) => {
  const originResult = validateRequestOrigin(request, url.origin)
  if (!originResult.valid) {
    log.warn(
      `[auth/expire] Cross-origin request blocked: ${originResult.reason}`,
      {
        requestId: locals.requestId,
        method: request.method,
        path: url.pathname,
      },
    )
    return new Response(null, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response(null, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return new Response(null, { status: 400 })
  }
  const { generation } = body as { generation?: unknown }
  if (typeof generation !== 'string' || generation === '') {
    return new Response(null, { status: 400 })
  }

  const cookie = cookies.get('coves_session')
  if (!cookie) return new Response(null, { status: 204 })
  if (sessionGenerationOf(cookie) !== generation) {
    return new Response(null, { status: 409 })
  }

  // Same attributes the logout endpoint uses, so the browser drops the cookie.
  cookies.delete('coves_session', { path: '/' })
  return new Response(null, { status: 204 })
}
