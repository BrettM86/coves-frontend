import type { RequestHandler } from './$types'

/**
 * Liveness probe for the Docker HEALTHCHECK (and any orchestrator).
 *
 * Deliberately dependency-free: it must report on this process only. Probing
 * a page like `/` couples frontend health to backend availability — with SSR
 * enabled, an AppView outage would 500 the page, flag the frontend container
 * unhealthy, and restart-loop it, masking the real failure.
 */
export const GET: RequestHandler = () => new Response('ok')
