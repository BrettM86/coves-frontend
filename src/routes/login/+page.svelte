<script lang="ts">
  import { browser } from '$app/environment'
  import { page } from '$app/state'
  import { t } from '$lib/app/i18n'
  import {
    DEFAULT_INSTANCE_URL,
    LINKED_INSTANCE_URL,
  } from '$lib/app/instance.svelte'
  import { DOMAIN_REGEX_FORMS, instanceToURL } from '$lib/app/util.svelte'
  import ErrorContainer, {
    clearErrorScope,
    pushError,
  } from '$lib/ui/info/ErrorContainer.svelte'
  import { Header } from '$lib/ui/layout'
  import { Button, Note, Spinner, TextInput } from 'mono-svelte'
  import { Icon, UserCircle } from 'svelte-hero-icons/dist'

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

  // Store redirect URL in sessionStorage if provided
  $effect(() => {
    if (ref && ref !== '/') {
      sessionStorage.setItem('oauth_redirect', ref)
    }
  })

  function buildOAuthUrl(instance: string, handle: string): string {
    const baseUrl = instanceToURL(instance)
    const redirectUri = browser
      ? `${window.location.origin}/oauth/callback`
      : '/oauth/callback'

    const params = new URLSearchParams({
      handle: handle.trim(),
      redirect_uri: redirectUri,
    })

    return `${baseUrl}/oauth/mobile/login?${params.toString()}`
  }

  async function startOAuthLogin(): Promise<void> {
    if (!browser) return

    form.loading = true
    clearErrorScope(page.route.id)

    try {
      // Validate handle format (basic ATProto handle validation)
      const handle = form.handle.trim()
      if (!handle) {
        throw new Error('handle_required')
      }

      // Store instance in sessionStorage for callback to retrieve
      const instance = form.instance.trim().replace(/^https:\/\//, '')
      sessionStorage.setItem('oauth_instance', instance)

      // Build OAuth URL and redirect
      const oauthUrl = buildOAuthUrl(instance, handle)
      window.location.href = oauthUrl
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
