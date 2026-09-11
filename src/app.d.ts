// See https://kit.svelte.dev/docs/types#app

import type { Component } from 'svelte'
import type { AccountSession, SealedToken } from '$lib/server/session'

// for information about these interfaces
declare global {
  namespace App {
    interface Error {
      code?: 'BackendUnavailable'
    }

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
       * Used by the logout endpoint and the server-side token fallback in
       * `$lib/api/client.svelte` after frontend session validation. The proxy
       * reads the opaque cookie directly and does not use this auth claim.
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
     * - 'rate_limited': /api/me could not check the session due to rate limiting.
     *   The session cookie is preserved so validation can be retried.
     * - 'validation_error': The /api/me response was received but contained invalid data.
     *   Indicates a server-side bug or protocol mismatch.
     */
    type AuthErrorKind = 'network_error' | 'rate_limited' | 'validation_error'

    /**
     * Server-side request-local state populated by hooks.server.ts.
     *
     * Uses a discriminated union to make invalid states unrepresentable:
     * - When authenticated, all auth fields are guaranteed present
     * - When unauthenticated, no auth fields are present
     */
    interface Locals {
      /**
       * Correlation id for this request, minted at the top of `handle()` and
       * echoed on the response as `x-request-id`, so every log line and error
       * response can be tied back to a single request. Set by `handle()`;
       * `handleError` may observe it unset on failures raised before
       * `handle()` ran.
       */
      requestId: string
      auth: AuthState
      /**
       * Set when session validation failed due to infrastructure, rate limiting, or invalid data
       * (as opposed to simply not having a session cookie).
       * The layout can use this to show a warning banner to the user.
       */
      authError?: AuthErrorKind
      /** Set to true when a 401 from /api/me indicates the session has expired or been revoked */
      sessionExpired?: boolean
      /**
       * Language this request renders in, resolved from the visitor's
       * `Accept-Language` header. Read by `$lib/app/state/i18n` through the
       * request-event accessor, so that one Node process can render different
       * languages concurrently. Stamped by the root `+layout.server.ts` load,
       * so it is unset outside a request and on error pages rendered before
       * that load runs; i18n then falls back to `en`.
       */
      lang?: string
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
declare const __VERSION__: string

declare module 'markdown-it-sub'
declare module 'markdown-it-sup'

declare module '*.svg?raw' {
  const content: string
  export default content
}

declare module '*.md?raw' {
  const content: string
  export default content
}
