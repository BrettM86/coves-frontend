import type { IconSource } from '$lib/ui/kit/icon'
import type { Snippet } from 'svelte'
import { get, writable } from 'svelte/store'

export const shownModal = writable<Modal | undefined>()
// Keep late failures visible after their dialog has closed or been replaced.
export const dismissedActionErrors = writable<unknown[]>([])

interface Modal {
  pendingAction?: Action
  error?: unknown
  actions: Action[]
  title: string
  body?: string
  /**
   * Whether the modal has a close button or not
   */
  dismissable: boolean
  snippet?: Snippet
  type: 'error' | 'info' | 'success'
}

export interface Action {
  /**
   * What function to run when this action is clicked. If undefined, it'll close the window.
   */
  action: () => Promise<void>
  type: 'danger' | 'secondary' | 'primary'
  /**
   * Button label. Undefined means "use the ModalContainer's `closeLabel`",
   * which is how the default close action gets a localized label without the
   * kit depending on the app's i18n.
   */
  content?: string
  icon?: IconSource
}

interface ActionInput {
  action?: () => void | Promise<void>
  type?: 'danger' | 'secondary' | 'primary'
  content?: string
  icon?: IconSource
  /** Close the modal after `action` runs. Defaults to true. */
  close?: boolean
}

/** The implicit dismiss button: no handler, labelled by `ModalContainer`. */
export function action(): Action
/** A labelled action. Closes the modal afterwards unless `close: false`. */
export function action(input: ActionInput & { content: string }): Action
export function action(input?: ActionInput): Action {
  const closeAfter = input?.close ?? true
  const result: Action = {
    action: async () => {
      const current = get(shownModal)
      if (!current || current.pendingAction) return
      current.pendingAction = result
      current.error = undefined
      shownModal.set(current)
      try {
        await input?.action?.()
        if (closeAfter && get(shownModal) === current) shownModal.set(undefined)
      } catch (error) {
        if (get(shownModal) === current) current.error = error
        else dismissedActionErrors.update((errors) => [...errors, error])
      } finally {
        current.pendingAction = undefined
        if (get(shownModal) === current) shownModal.set(current)
      }
    },
    type: input?.type ?? 'secondary',
    // Empty labels fall back to `closeLabel` too, never a blank button.
    content: input?.content || undefined,
    icon: input?.icon,
  }
  return result
}

export function modal(inputModal: {
  actions?: Action[]
  title: string
  body?: string
  /**
   * Whether the modal has a close button or not
   */
  dismissable?: boolean
  snippet?: Snippet
  type?: 'error' | 'info' | 'success'
}) {
  const modal: Modal = {
    actions: inputModal.actions ?? [action()],
    dismissable: inputModal.dismissable ?? true,
    title: inputModal.title,
    body: inputModal.body,
    type: inputModal.type ?? 'info',
    snippet: inputModal.snippet,
  }

  shownModal.set(modal)
}
