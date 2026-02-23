// See https://kit.svelte.dev/docs/types#app

import type { Component } from 'svelte'
import type { AccountSession, SealedToken } from '$lib/server/session'

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
      /** The authenticated account */
      readonly account: AccountSession
      /**
       * Convenience alias for `account.sealedToken`.
       * Duplicated at the top level so the proxy layer (`/api/proxy/[...path]`)
       * can read the token directly from `locals.auth.authToken` without
       * reaching into the nested account object on every proxied request.
       */
      readonly authToken: SealedToken
    }

    /**
     * Discriminated union for authentication state.
     * Use `locals.auth.authenticated` to narrow the type.
     *
     * @example
     * ```typescript
     * if (locals.auth.authenticated) {
     *   // TypeScript knows account and authToken exist
     *   console.log(locals.auth.account.did)
     * }
     * ```
     */
    type AuthState = UnauthenticatedAuth | AuthenticatedAuth

    /**
     * Categories of authentication errors that can occur during session validation.
     * These allow downstream code (layouts, pages) to show appropriate user feedback.
     *
     * - 'network_error': Infrastructure failure (DNS, TLS, timeout, connection refused).
     *   The session cookie is preserved because the error may be temporary.
     * - 'validation_error': The /api/me response was received but contained invalid data.
     *   Indicates a server-side bug or protocol mismatch.
     */
    type AuthErrorKind = 'network_error' | 'validation_error'

    /**
     * Server-side request-local state populated by hooks.server.ts.
     *
     * Uses a discriminated union to make invalid states unrepresentable:
     * - When authenticated, all auth fields are guaranteed present
     * - When unauthenticated, no auth fields are present
     */
    interface Locals {
      auth: AuthState
      /**
       * Set when authentication failed due to an infrastructure or validation error
       * (as opposed to simply not having a session cookie).
       * The layout can use this to show a warning banner to the user.
       */
      authError?: AuthErrorKind
      /** Set to true when a 401 from /api/me indicates the session has expired or been revoked */
      sessionExpired?: boolean
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

declare module '*.svg?raw' {
  const content: string
  export default content
}

declare module '*.md?raw' {
  const content: string
  export default content
}
