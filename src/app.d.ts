// See https://kit.svelte.dev/docs/types#app

import type { Component } from 'svelte'
import type { AccountSession, AppSession, SealedToken } from '$lib/server/session'

// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}

    /**
     * Unauthenticated auth state - no valid session.
     */
    interface UnauthenticatedAuth {
      readonly authenticated: false
    }

    /**
     * Authenticated auth state - valid session with active account.
     * All fields are guaranteed to be present when authenticated is true.
     */
    interface AuthenticatedAuth {
      readonly authenticated: true
      /** The complete session with all accounts */
      readonly session: AppSession
      /** The currently active account */
      readonly activeAccount: AccountSession
      /** The sealed token for API requests */
      readonly authToken: SealedToken
    }

    /**
     * Discriminated union for authentication state.
     * Use `locals.auth.authenticated` to narrow the type.
     *
     * @example
     * ```typescript
     * if (locals.auth.authenticated) {
     *   // TypeScript knows session, activeAccount, and authToken exist
     *   console.log(locals.auth.session.activeAccountId)
     * }
     * ```
     */
    type AuthState = UnauthenticatedAuth | AuthenticatedAuth

    /**
     * Server-side request-local state populated by hooks.server.ts.
     *
     * Uses a discriminated union to make invalid states unrepresentable:
     * - When authenticated, all auth fields are guaranteed present
     * - When unauthenticated, no auth fields are present
     */
    interface Locals {
      auth: AuthState
    }
    interface PageData {
      slots?: {
        sidebar?: {
          /**
           * A Svelte component to render in the sidebar slot.
           * Uses `Component` with `Record<string, unknown>` because different pages
           * pass different components (CommunityCard, etc.) with varying prop shapes.
           */
          component?: Component<Record<string, unknown>>
          /**
           * Props to spread onto the sidebar component.
           * Typed as `Record<string, unknown>` because this is a dynamic slot system
           * where different components receive different props at runtime.
           */
          props?: Record<string, unknown>
        }
      }
      contextual?: {
        actions?: Action[]
      }
    }
    interface PageState {
      openImage?: string
      openModals?: string[]
    }
    // interface Platform {}
  }
  declare const __VERSION__: string
}

export {}
// eslint-disable-next-line
declare const __VERSION__: string

declare module 'markdown-it-sub'
declare module 'markdown-it-sup'

declare module '@xylightdev/svelte-hero-icons' {
  interface IconProps {
    'aria-label'?: string
    'aria-hidden'?: boolean
    title?: string
  }
}
