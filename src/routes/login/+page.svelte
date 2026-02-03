<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { t } from '$lib/app/i18n'
  import {
    DEFAULT_INSTANCE_URL,
    LINKED_INSTANCE_URL,
  } from '$lib/app/instance.svelte'
  import { DOMAIN_REGEX_FORMS } from '$lib/app/util.svelte'
  import ErrorContainer, {
    clearErrorScope,
    pushError,
  } from '$lib/ui/info/ErrorContainer.svelte'
  import { Header } from '$lib/ui/layout'
  import { Button, Note, Spinner, TextInput } from 'mono-svelte'
  import { Icon, UserCircle } from 'svelte-hero-icons/dist'

  /**
   * Maps OAuth error codes from URL params to user-friendly i18n keys.
   */
  const ERROR_CODE_MAP: Record<string, string> = {
    no_session: 'oauth.error.noSession',
    no_pending_auth: 'oauth.error.noPendingAuth',
    fetch_failed: 'oauth.error.fetchFailed',
    invalid_user_info: 'oauth.error.invalidUserInfo',
    invalid_credential_format: 'oauth.error.invalidCredentialFormat',
    server_config: 'oauth.error.serverConfig',
    invalid_state: 'oauth.error.invalidState',
  }

  interface Props {
    ref?: string
    children?: import('svelte').Snippet
  }

  let {
    ref = page.url.searchParams.get('redirect') ?? '/',
    children,
  }: Props = $props()

  let form = $state<{
    instance: string
    handle: string
    loading: boolean
  }>({
    instance: LINKED_INSTANCE_URL ?? DEFAULT_INSTANCE_URL,
    handle: '',
    loading: false,
  })

  // Check for error query param on mount and display appropriate message
  $effect(() => {
    if (!browser) return

    const errorCode = page.url.searchParams.get('error')
    if (errorCode) {
      const errorKey = ERROR_CODE_MAP[errorCode]
      const errorMessage = errorKey ? $t(errorKey) : $t('oauth.error.generic')

      pushError({
        message: errorMessage,
        scope: page.route.id!,
      })

      // Clean up the URL by removing the error param
      const url = new URL(page.url)
      url.searchParams.delete('error')
      goto(url.pathname + url.search, { replaceState: true })
    }
  })

  /**
   * Start OAuth login by calling the server-side login endpoint.
   * The server handles OAuth state generation and redirect URL construction.
   */
  async function startOAuthLogin(): Promise<void> {
    if (!browser) return

    form.loading = true
    clearErrorScope(page.route.id)

    try {
      // Validate handle format (basic validation)
      const handle = form.handle.trim()
      if (!handle) {
        throw new Error('handle_required')
      }

      const instance = form.instance.trim().replace(/^https:\/\//, '')

      // Call server-side login endpoint
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle,
          instance,
          redirect: ref,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error ?? 'login_failed')
      }

      const { redirectUrl } = await response.json()

      // Redirect to OAuth provider
      window.location.href = redirectUrl
    } catch (error) {
      pushError({
        message:
          error instanceof Error ? error.message : $t('error.unknown'),
        scope: page.route.id!,
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
      <ErrorContainer class="pt-2" scope={page.route.id} />
    </div>

    <Note>
      {$t('oauth.loginInfo')}
    </Note>

    <div class="flex flex-row w-full items-center gap-2">
      <TextInput
        id="handle"
        bind:value={form.handle}
        label={$t('form.handle')}
        placeholder="user.bsky.social"
        class="flex-1"
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
        {$t('account.login')}
      {/if}
    </Button>

    <hr class="border-slate-200 dark:border-zinc-800" />

    <div class="flex flex-row items-center gap-2 overflow-auto *:shrink-0">
      {#if !LINKED_INSTANCE_URL}
        <Button rounding="pill" color="ghost" href="/login/guest">
          <Icon src={UserCircle} mini size="16" />
          {$t('account.guest')}
        </Button>
      {/if}
    </div>
  </form>
</div>
