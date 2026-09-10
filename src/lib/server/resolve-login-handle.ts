import { XrpcHandleResolver } from '@atcute/identity-resolver'
import { isHandle } from '@atcute/lexicons/syntax'
import { stampClientAddress } from '$lib/server/client-address'
import { upstreamInstanceUrl } from '$lib/server/instance'

/**
 * Preflight only: the OAuth backend still authenticates the resolved identity.
 *
 * Resolution goes through this deployment's own AppView, which answers local
 * handles from its database and external ones behind its SSRF-safe resolver.
 * That keeps the outbound host fixed: a handle typed at the login form is
 * attacker-chosen input, and under the previous DNS-over-HTTPS plus well-known
 * resolution it selected the host this Node process fetched.
 *
 * atcute maps the AppView's 400 to a `DidNotFoundError`, so a handle with no
 * account stays distinguishable from an AppView that is down without any
 * mapping here.
 *
 * @param handle - the normalized handle to check
 * @param getClientAddress - the request event's `getClientAddress`, stamped
 *   onto the outbound request. The AppView rate-limits handle resolution per
 *   client address; unstamped, every visitor's preflight arrives as this
 *   frontend container's own address and shares one bucket, so the limit locks
 *   the whole deployment out of logging in.
 */
export async function resolveLoginHandle(
  handle: string,
  getClientAddress: () => string,
): Promise<void> {
  if (!isHandle(handle)) throw new Error('invalid_handle')

  await resolver(getClientAddress).resolve(handle, {
    signal: AbortSignal.timeout(10_000),
  })
}

/**
 * Built per call, not at module load: the instance URL is runtime env, the
 * client address is per request, and a resolver instance is cheap.
 */
function resolver(getClientAddress: () => string): XrpcHandleResolver {
  return new XrpcHandleResolver({
    serviceUrl: upstreamInstanceUrl(),
    fetch: (input, init) => {
      const headers = new Headers(init?.headers)
      // Degrades to no header when the address cannot be read, rather than
      // failing the login or claiming an address nobody observed.
      stampClientAddress(headers, getClientAddress, 'login')
      return globalThis.fetch(input, { ...init, headers })
    },
  })
}
