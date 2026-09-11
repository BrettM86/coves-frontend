import { afterEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { action, modal, shownModal } from './modal'

function deferred() {
  let resolve = () => {}
  let reject = (_error: Error) => {}
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

afterEach(() => shownModal.set(undefined))

describe('confirmation actions', () => {
  it('keeps the confirmation open until the destructive request finishes', async () => {
    const request = deferred()
    const confirm = action({ content: 'Delete', action: () => request.promise })
    modal({ title: 'Delete post', actions: [confirm] })
    const opened = get(shownModal)

    const completion = confirm.action()
    expect(get(shownModal)).toBe(opened)
    request.resolve()
    await completion
    expect(get(shownModal)).toBeUndefined()
  })

  it('ignores duplicate confirmations while the request is pending', async () => {
    const request = deferred()
    const remove = vi.fn(() => request.promise)
    const confirm = action({ content: 'Delete', action: remove })
    modal({ title: 'Delete post', actions: [confirm] })

    const completion = confirm.action()
    confirm.action()
    expect(remove).toHaveBeenCalledTimes(1)
    request.resolve()
    await completion
  })

  it('keeps a failed confirmation open and permits retry', async () => {
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error('Deletion failed'))
      .mockResolvedValue(undefined)
    const confirm = action({ content: 'Delete', action: remove })
    modal({ title: 'Delete post', actions: [confirm] })

    // Either propagation or rendering is valid, but the modal must remain retryable.
    await Promise.resolve(confirm.action()).catch(() => {})
    expect(get(shownModal)?.title).toBe('Delete post')
    await confirm.action()
    expect(remove).toHaveBeenCalledTimes(2)
    expect(get(shownModal)).toBeUndefined()
  })

  it('does not dismiss a newer modal when an older request completes', async () => {
    const request = deferred()
    const confirm = action({ content: 'Delete', action: () => request.promise })
    modal({ title: 'Delete post', actions: [confirm] })
    const completion = confirm.action()
    modal({ title: 'A newer confirmation' })
    request.resolve()
    await completion
    expect(get(shownModal)?.title).toBe('A newer confirmation')
  })

  it('honors close false after a successful async action', async () => {
    const confirm = action({
      content: 'Save',
      action: async () => {},
      close: false,
    })
    modal({ title: 'Editor', actions: [confirm] })
    await confirm.action()
    expect(get(shownModal)?.title).toBe('Editor')
  })
})
