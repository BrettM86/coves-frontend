import { browser } from '$app/environment'

/**
 * Streams `promise` to the client when running in the browser, but awaits it
 * during SSR so the server never renders a pending placeholder.
 */
export const awaitIfServer = async <T>(
  promise: Promise<T>,
): Promise<{
  data: Promise<T> | T
}> => ({ data: browser ? promise : await promise })
