import license from '../../../LICENSE?raw'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = () =>
  new Response(license, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
