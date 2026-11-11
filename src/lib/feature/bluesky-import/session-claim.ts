/**
 * The automatic offer checks at most once per browser tab session per DID.
 * sessionStorage carries claims across reloads; storage access can throw, so
 * an in-memory set gates repeat claims within the page regardless.
 */
const KEY_PREFIX = 'coves.blueskyImportChecked:'
const claimed = new Set<string>()

/** True the first time `did` is claimed this session, false after. */
export function claimAutomaticCheck(did: string): boolean {
  if (claimed.has(did)) return false
  claimed.add(did)
  try {
    if (sessionStorage.getItem(KEY_PREFIX + did) !== null) return false
  } catch {
    // Storage unavailable; the in-memory claim still applies.
  }
  try {
    sessionStorage.setItem(KEY_PREFIX + did, '1')
  } catch {
    // Storage unavailable; the in-memory claim still applies.
  }
  return true
}
