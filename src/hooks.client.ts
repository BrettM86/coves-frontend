import type { HandleClientError } from '@sveltejs/kit'

export const handleError: HandleClientError = ({ error, status, message }) => {
  // Log the full error for debugging — without this, client-side crashes
  // vanish silently.
  console.error(`[client error] ${status}:`, error)

  // Return only SvelteKit's sanitized message (e.g. "Internal Error") so raw
  // stack traces / internal error objects are never rendered to users.
  return { message }
}
