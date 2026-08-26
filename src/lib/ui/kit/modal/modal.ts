import type { IconSource } from '@xylightdev/svelte-hero-icons'
import type { Snippet } from 'svelte'
import { writable } from 'svelte/store'

export const shownModal = writable<Modal | undefined>()

interface Modal {
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
  action: () => void
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
  action?: () => void
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
  return {
    action: input?.action
      ? () => {
          input.action?.()
          if (closeAfter) shownModal.set(undefined)
        }
      : () => shownModal.set(undefined),
    type: input?.type ?? 'secondary',
    // Empty labels fall back to `closeLabel` too, never a blank button.
    content: input?.content || undefined,
    icon: input?.icon,
  }
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
