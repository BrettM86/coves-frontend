import { XrpcHandleResolver } from '@atcute/identity-resolver'
import { isHandle } from '@atcute/lexicons/syntax'

/** Preflight only: the OAuth backend still authenticates the resolved identity. */
export async function resolveLoginHandle(handle: string): Promise<void> {
  if (!isHandle(handle)) throw new Error('invalid_handle')

  // Use a fixed public resolver so submitted handles cannot direct server
  // requests to private networks. This resolves atProto identities, not profiles.
  const resolver = new XrpcHandleResolver({
    serviceUrl: 'https://public.api.bsky.app',
  })
  await resolver.resolve(handle, { signal: AbortSignal.timeout(10_000) })
}
