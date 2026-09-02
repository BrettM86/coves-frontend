import { beforeEach, describe, expect, it, vi } from 'vitest'

const { goto, remove, toast } = vi.hoisted(() => ({
  goto: vi.fn<(url: string, opts?: unknown) => Promise<void>>(async () => {}),
  remove: vi.fn<(id: string) => Promise<unknown>>(),
  toast: vi.fn<(opts: unknown) => void>(),
}))

vi.mock('$app/navigation', () => ({ goto }))

vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: {
    get current() {
      return { id: 'did:plc:mari', type: 'authenticated' }
    },
    remove,
  },
}))

vi.mock('$lib/ui/kit/toast/toasts', () => ({ toast }))

vi.mock('$lib/app/state/i18n', () => ({
  t: { get: (key: string) => key },
}))

import { logout } from './logout'

beforeEach(() => {
  goto.mockClear()
  remove.mockReset()
  toast.mockClear()
})

describe('logout', () => {
  it('removes the active profile and returns to the front page', async () => {
    remove.mockResolvedValue({ success: true })

    await expect(logout()).resolves.toBe(true)

    expect(remove).toHaveBeenCalledWith('did:plc:mari')
    expect(goto).toHaveBeenCalledWith('/', { invalidateAll: true })
    expect(toast).not.toHaveBeenCalled()
  })

  it('stays put and reports the server error when logout fails', async () => {
    remove.mockResolvedValue({ success: false, error: 'Logout failed: 500' })

    await expect(logout()).resolves.toBe(false)

    expect(goto).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith({
      content: 'Logout failed: 500',
      type: 'error',
    })
  })

  it('falls back to the generic error when the failure carries no message', async () => {
    remove.mockResolvedValue({ success: false })

    await logout()

    expect(toast).toHaveBeenCalledWith({
      content: 'error.unknown',
      type: 'error',
    })
  })

  it('reports a thrown error without navigating', async () => {
    remove.mockRejectedValue(new Error('offline'))

    await expect(logout()).resolves.toBe(false)

    expect(goto).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith({ content: 'offline', type: 'error' })
  })

  it('warns but still navigates when only the remote revocation failed', async () => {
    remove.mockResolvedValue({ success: true, remoteLogoutFailed: true })

    await expect(logout()).resolves.toBe(true)

    expect(toast).toHaveBeenCalledWith({
      content: 'oauth.error.remoteLogoutFailed',
      type: 'warning',
      long: true,
    })
    expect(goto).toHaveBeenCalledWith('/', { invalidateAll: true })
  })
})
