<!--
  NOTE: OAuth tokens are passed via URL query params by design. This follows the
  ATProto mobile OAuth flow (RFC 8252 private-use URI scheme pattern). The alternative
  (cookie-based web OAuth) conflicts with the client-side multi-account model.
  The backend clears tokens from URLs via meta refresh redirect.
-->
<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import { Button, Spinner } from 'mono-svelte'
  import { Icon, ExclamationTriangle } from 'svelte-hero-icons/dist'

  let status = $state<'loading' | 'success' | 'error'>('loading')
  let errorMessage = $state('')

  $effect(() => {
    handleCallback()
  })

  async function handleCallback(): Promise<void> {
    const params = page.url.searchParams

    const token = params.get('token')
    const did = params.get('did')
    const sessionId = params.get('session_id')
    const handle = params.get('handle')

    const instance = sessionStorage.getItem('oauth_instance')

    // Validate required params
    if (!token || !did || !sessionId || !handle) {
      status = 'error'
      errorMessage = $t('oauth.missingParams')
      return
    }

    if (!instance) {
      status = 'error'
      errorMessage = $t('oauth.missingInstance')
      return
    }

    // Create the profile
    const success = await profile.addOAuthProfile({
      instance,
      token,
      did,
      sessionId,
      handle,
    })

    if (success) {
      // Get redirect URL and clean up session storage
      const redirectUrl = sessionStorage.getItem('oauth_redirect') ?? '/'
      sessionStorage.removeItem('oauth_instance')
      sessionStorage.removeItem('oauth_redirect')
      status = 'success'
      goto(redirectUrl)
    } else {
      status = 'error'
      errorMessage = $t('oauth.profileCreationFailed')
    }
  }
</script>

<svelte:head>
  <title>{$t('oauth.callback')}</title>
</svelte:head>

<div class="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-4">
  {#if status === 'loading'}
    <Spinner width={48} />
    <p class="text-lg text-slate-600 dark:text-zinc-400">
      {$t('oauth.processing')}
    </p>
  {:else if status === 'error'}
    <div class="flex flex-col items-center gap-4 max-w-md text-center">
      <div
        class="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center"
      >
        <Icon
          src={ExclamationTriangle}
          class="w-8 h-8 text-red-600 dark:text-red-400"
        />
      </div>
      <h1 class="text-xl font-semibold text-slate-900 dark:text-zinc-100">
        {$t('oauth.authFailed')}
      </h1>
      <p class="text-slate-600 dark:text-zinc-400">
        {errorMessage}
      </p>
      <Button href="/login" color="primary">
        {$t('oauth.backToLogin')}
      </Button>
    </div>
  {/if}
</div>
