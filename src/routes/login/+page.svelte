<script lang="ts">
  import { browser } from '$app/environment'
  import { afterNavigate, replaceState } from '$app/navigation'
  import { page } from '$app/state'
  import { tick } from 'svelte'
  import { t } from '$lib/app/state/i18n'
  import {
    DEFAULT_INSTANCE_URL,
    LINKED_INSTANCE_URL,
  } from '$lib/app/state/instance.svelte'
  import { consumeLoginError } from '$lib/app/util/login-error'
  import { DOMAIN_REGEX_FORMS } from '$lib/app/util/url'
  import ErrorContainer, {
    clearErrorScope,
  } from '$lib/ui/info/ErrorContainer.svelte'
  import { Header } from '$lib/ui/layout'
  import { Button, toast } from '$lib/ui/kit'
  import { AtSign, Icon, Server } from '$lib/ui/kit/icon'

  // The handle field is a single underline rather than a box. The underline
  // keeps at least 3:1 contrast against the page (WCAG 1.4.11), focus turns
  // it into a 2px line in the accent colour, and the input is 48px tall so
  // it stays a comfortable tap target.
  const labelClass = 'text-sm font-medium text-slate-600 dark:text-zinc-400'
  const lineClass = `group flex items-center gap-2 border-b border-slate-500
    dark:border-zinc-500 transition-[border-color,box-shadow]
    focus-within:border-primary-900 dark:focus-within:border-primary-100
    focus-within:shadow-[0_1px_0_0_var(--color-primary-900)]
    dark:focus-within:shadow-[0_1px_0_0_var(--color-primary-100)]`
  const inputClass = `min-h-12 min-w-0 flex-1 bg-transparent py-2 text-base
    outline-hidden placeholder:text-slate-500 dark:placeholder:text-zinc-400`
  const iconClass = `shrink-0 text-slate-500 dark:text-zinc-400 transition-colors
    group-focus-within:text-primary-900 dark:group-focus-within:text-primary-100`

  /**
   * Maps OAuth error codes from URL params to user-friendly i18n keys.
   */
  const ERROR_CODE_MAP: Record<string, string> = {
    account_not_found: 'oauth.error.accountNotFound',
    handle_resolution_failed: 'oauth.error.handleResolutionFailed',
    invalid_handle: 'oauth.error.invalidHandle',
    access_denied: 'oauth.error.accessDenied',
    invalid_request: 'oauth.error.invalidRequest',
    server_error: 'oauth.error.serverError',
    temporarily_unavailable: 'oauth.error.serverError',
  }

  interface Props {
    children?: import('svelte').Snippet
  }

  let { children }: Props = $props()
  let returnTarget = $derived(page.url.searchParams.get('redirect') ?? '/')
  let errorCode = $state<string | null>(null)

  afterNavigate(async () => {
    // Initial hydration invokes afterNavigate before the router is initialized.
    await tick()
    // Shallow replaceState retains page.url for routing, so read the browser's
    // current history URL to avoid reviving a consumed error on back navigation.
    const arrival = consumeLoginError(new URL(window.location.href))
    errorCode = arrival.errorCode
    if (arrival.replaceUrl) {
      try {
        replaceState(arrival.replaceUrl, page.state)
      } catch {
        // The router may not be ready yet; still drop the consumed error
        // from history rather than leaving ?error= in the URL.
        history.replaceState(history.state, '', arrival.replaceUrl)
      }
    }
  })
  let errorMessage = $derived(
    errorCode
      ? $t(
          Object.hasOwn(ERROR_CODE_MAP, errorCode)
            ? ERROR_CODE_MAP[errorCode]
            : 'oauth.error.generic',
        )
      : undefined,
  )

  let form = $state<{
    instance: string
    handle: string
    loading: boolean
  }>({
    instance: LINKED_INSTANCE_URL ?? DEFAULT_INSTANCE_URL,
    handle: '',
    loading: false,
  })

  /**
   * Start OAuth login by calling the SvelteKit login endpoint, which
   * validates the return destination and returns the Go-owned login URL.
   * Go generates the OAuth state and the browser binding.
   */
  async function startOAuthLogin(): Promise<void> {
    if (!browser || form.loading) return

    form.loading = true
    errorCode = null
    clearErrorScope(page.route.id)

    try {
      // Validate handle format (basic validation)
      const handle = form.handle.trim()
      if (!handle) {
        throw new Error($t('oauth.error.invalidHandle'))
      }

      const instance = form.instance.trim().replace(/^https:\/\//, '')

      // Call server-side login endpoint
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle,
          instance,
          redirect: returnTarget,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorKey = Object.hasOwn(ERROR_CODE_MAP, errorData.error)
          ? ERROR_CODE_MAP[errorData.error]
          : undefined
        throw new Error(errorKey ? $t(errorKey) : $t('oauth.error.generic'))
      }

      const { redirectUrl } = await response.json()

      // Redirect to OAuth provider
      window.location.href = redirectUrl
    } catch (error) {
      toast({
        content:
          error instanceof Error ? error.message : $t('oauth.error.generic'),
        type: 'error',
      })
      form.loading = false
    }
  }
</script>

<svelte:head>
  <title>{$t('account.login')}</title>
</svelte:head>

<div class="max-w-sm w-full mx-auto h-max mt-6 sm:mt-10">
  <form
    onsubmit={(e) => {
      e.preventDefault()
      startOAuthLogin()
    }}
    class="flex flex-col gap-6"
  >
    <div class="flex flex-col gap-2">
      {@render children?.()}
      <Header size="sm" class="font-semibold">{$t('account.login')}</Header>
      <p id="login-info" class="text-sm text-muted dark:text-zinc-400">
        {$t('oauth.loginInfo')}
      </p>
      <ErrorContainer
        class="pt-2"
        scope={page.route.id}
        message={errorMessage}
      />
    </div>

    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <label for="handle" class={labelClass}>{$t('form.handle')}</label>
        <div class={lineClass}>
          <Icon src={AtSign} size="20" class={iconClass} />
          <input
            id="handle"
            type="text"
            bind:value={form.handle}
            placeholder="user.bsky.social"
            required
            autocomplete="username"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            aria-describedby="login-info"
            class={inputClass}
          />
        </div>
      </div>
      {#if !LINKED_INSTANCE_URL}
        <div class="flex flex-col gap-1">
          <label for="instance_url" class={labelClass}>
            {$t('form.instance')}
          </label>
          <div class={lineClass}>
            <Icon src={Server} size="20" class={iconClass} />
            <input
              id="instance_url"
              type="text"
              bind:value={form.instance}
              placeholder={DEFAULT_INSTANCE_URL}
              required
              pattern={DOMAIN_REGEX_FORMS}
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              class={inputClass}
            />
          </div>
        </div>
      {/if}
    </div>

    <Button
      loading={form.loading}
      loaderWidth={20}
      disabled={form.loading}
      color="primary"
      size="lg"
      class="w-full"
      submit
    >
      {#if form.loading}
        {$t('oauth.redirecting')}
      {:else}
        {$t('oauth.continueLogin')}
      {/if}
    </Button>
  </form>
</div>
