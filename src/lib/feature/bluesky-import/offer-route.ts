/** Whether the automatic offer may run on `pathname`: not on sign-in, account or settings pages. */
export function shouldOfferOnPath(pathname: string): boolean {
  return !(
    pathname === '/login' ||
    pathname === '/accounts' ||
    pathname.startsWith('/accounts/') ||
    pathname === '/profile/settings'
  )
}
