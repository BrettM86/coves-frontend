import { goto } from '$app/navigation'
import { profile } from '$lib/app/state/auth.svelte'
import { t } from '$lib/app/state/i18n'
import { toast } from '$lib/ui/kit/toast/toasts'

/**
 * Sign the current account out and return the reader to the front page.
 *
 * Coves runs one account per browser, so "log out" always means the active
 * profile. On failure the session is left in place and the reader is told why;
 * a local-only logout (the server could not revoke the token upstream) still
 * navigates but warns, since the reader is signed out here either way.
 *
 * @returns whether the reader ended up signed out.
 */
export async function logout(): Promise<boolean> {
  let result: Awaited<ReturnType<typeof profile.remove>>
  try {
    result = await profile.remove(profile.current.id)
  } catch (err) {
    toast({
      content: err instanceof Error ? err.message : t.get('error.unknown'),
      type: 'error',
    })
    return false
  }

  if (!result.success) {
    toast({ content: result.error ?? t.get('error.unknown'), type: 'error' })
    return false
  }

  if (result.remoteLogoutFailed) {
    toast({
      content: t.get('oauth.error.remoteLogoutFailed'),
      type: 'warning',
      long: true,
    })
  }

  await goto('/', { invalidateAll: true })
  return true
}
