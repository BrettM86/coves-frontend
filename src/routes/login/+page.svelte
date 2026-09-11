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
  import { Button, Spinner, TextInput, toast } from '$lib/ui/kit'

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

<div class="max-w-xl w-full mx-auto h-max my-auto">
  <form
    onsubmit={(e) => {
      e.preventDefault()
      startOAuthLogin()
    }}
    class="flex flex-col gap-5"
  >
    <div class="flex flex-col">
      {@render children?.()}
      <Header>{$t('account.login')}</Header>
      <ErrorContainer
        class="pt-2"
        scope={page.route.id}
        message={errorMessage}
      />
    </div>

    <div class="flex flex-row w-full items-center gap-2">
      <TextInput
        id="handle"
        bind:value={form.handle}
        label={$t('form.handle')}
        placeholder="user.bsky.social"
        class="flex-1 placeholder:text-slate-500 dark:placeholder:text-zinc-400 [&>label]:after:content-none"
        required
        autocorrect="off"
        autocapitalize="off"
      />
      {#if !LINKED_INSTANCE_URL}
        <TextInput
          id="instance_url"
          placeholder={DEFAULT_INSTANCE_URL}
          bind:value={form.instance}
          class="flex-1 overflow-hidden"
          required
          pattern={DOMAIN_REGEX_FORMS}
          autocorrect="off"
          autocapitalize="off"
        >
          {#snippet customLabel()}
            {$t('form.instance')}
          {/snippet}
        </TextInput>
      {/if}
    </div>

    <Button
      loading={form.loading}
      disabled={form.loading}
      color="primary"
      size="lg"
      submit
    >
      {#if form.loading}
        <Spinner width={20} />
        {$t('oauth.redirecting')}
      {:else}
        {$t('oauth.continueLogin')}
      {/if}
    </Button>
    <p class="text-center text-sm text-slate-600 dark:text-zinc-400">
      {$t('oauth.loginInfo')}
    </p>
  </form>
</div>
