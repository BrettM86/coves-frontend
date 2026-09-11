/** Builds a login link while keeping the current destination for the return trip. */
export function loginUrl(url: URL): string {
  const destination =
    url.pathname === '/login'
      ? (url.searchParams.get('redirect') ?? '/')
      : url.pathname + url.search + url.hash
  return '/login?' + new URLSearchParams({ redirect: destination })
}
