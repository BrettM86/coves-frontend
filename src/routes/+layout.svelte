<script lang="ts">
  import { browser } from '$app/environment'
  import { navigating, page } from '$app/state'
  import { site } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/auth.svelte'
  import { locale } from '$lib/app/i18n'
  import { LINKED_INSTANCE_URL } from '$lib/app/instance.svelte'
  import { settings } from '$lib/app/settings.svelte'
  import { getDefaultColors } from '$lib/app/theme/presets'
  import {
    inDarkColorScheme,
    rgbToHex,
    theme,
  } from '$lib/app/theme/theme.svelte'
  import InstanceCard from '$lib/feature/instance/InstanceCard.svelte'
  import Moderation from '$lib/feature/moderation/Moderation.svelte'
  import ExpandableImage from '$lib/ui/generic/ExpandableImage.svelte'
  import { Shell } from '$lib/ui/layout'
  import Navbar from '$lib/ui/navbar/Navbar.svelte'
  import Sidebar from '$lib/ui/sidebar/Sidebar.svelte'
  import {
    Button,
    ModalContainer,
    Spinner,
    toast,
    ToastContainer,
  } from 'mono-svelte'
  import { t } from '$lib/app/i18n'
  import nProgress from 'nprogress'
  import 'nprogress/nprogress.css'
  import { onMount } from 'svelte'
  import { Forward } from 'svelte-hero-icons/dist'
  import '../app.css'

  interface Props {
    children?: import('svelte').Snippet
  }

  let { children }: Props = $props()

  nProgress.configure({
    minimum: 0.4,
    trickleSpeed: 200,
    easing: 'ease-out',
    speed: 300,
    showSpinner: false,
  })

  /**
   * Reads and clears the kelp_flash cookie for session expiration messages.
   * This cookie is set by the server when session decryption fails.
   */
  function handleFlashMessage() {
    const cookies = document.cookie.split(';')
    const flashCookie = cookies.find((c) => c.trim().startsWith('kelp_flash='))
    if (!flashCookie) return

    try {
      const value = decodeURIComponent(flashCookie.split('=')[1])
      const flash = JSON.parse(value) as { type: string; message: string }

      if (flash.type === 'session_expired') {
        toast({ content: $t('toast.sessionExpired'), type: 'warning' })
      }
    } catch {
      // Invalid flash cookie format - ignore
    }

    // Clear the cookie regardless of success/failure
    document.cookie = 'kelp_flash=; path=/; max-age=0'
  }

  onMount(() => {
    if (browser) {
      // Handle flash messages from server (e.g., session expiration)
      handleFlashMessage()

      if (window.location.hash == 'main') {
        history.replaceState(
          null,
          '',
          window.location.toString().replace('#main', ''),
        )
      }
      document.body.querySelector('.loader')?.classList.add('hidden')
    }
  })

  if (browser) {
    $effect(() => {
      if (settings) {
        document.documentElement.classList.remove(
          'font-inter',
          'font-sans',
          'font-system',
        )
        document.documentElement.classList.add(
          settings.font == 'inter'
            ? 'font-inter'
            : settings.font == 'system'
              ? 'font-system'
              : 'font-sans',
        )
      }
    })

    $effect(() => {
      document.documentElement.setAttribute('style', theme.vars)
    })

    $effect(() => {
      document.documentElement.dir =
        ($locale == 'he' || $locale == 'ar') && settings.useRtl ? 'rtl' : 'ltr'
    })
  }

  // Sync server-validated session into client-side profile state.
  // hooks.server.ts validates the coves_session cookie and returns the user
  // via +layout.server.ts; this effect hydrates the client profile from it.
  $effect(() => {
    profile.syncFromServer(page.data.session ?? undefined)
  })

  let nprogressTimeout = -1
  $effect(() => {
    if (navigating.to) {
      clearTimeout(nprogressTimeout)
      nprogressTimeout = setTimeout(
        () => nProgress.start(),
        200,
      ) as unknown as number
    } else {
      if (nprogressTimeout > -1) {
        clearTimeout(nprogressTimeout)
        nprogressTimeout = -1
        nProgress.done()
      }
    }
  })
</script>

<svelte:head>
  {#if site.data?.site_view}
    <meta
      name="theme-color"
      content={rgbToHex(
        theme.colorScheme && inDarkColorScheme()
          ? (theme.current.colors.zinc?.[925] ?? getDefaultColors().zinc[925])
          : (theme.current.colors.slate?.[25] ?? getDefaultColors().slate[25]),
      )}
    />
    {#if LINKED_INSTANCE_URL}
      <link rel="icon" href={site.data?.site_view?.site.icon} />
      <meta
        name="description"
        content={site.data?.site_view?.site.description}
      />
    {:else}
      <meta name="description" content="A sleek client for Lemmy" />
    {/if}
  {/if}
</svelte:head>

<Button
  class="fixed -top-16 focus:top-0 left-0 m-4 z-300 transition-all"
  href="#main"
  icon={Forward}
>
  Skip Navigation
</Button>

<Shell>
  <Moderation />
  <ToastContainer />
  <ExpandableImage />
  <ModalContainer />

  {#snippet sidebar({ style: s, class: c })}
    <Sidebar class={[c, 'p-3 sm:p-6 w-full']} style={s} />
  {/snippet}
  {#snippet main({ style: s, class: c })}
    <main
      class="px-3 pt-3 sm:px-6 sm:pt-6 min-w-0 w-full flex flex-col h-full relative {c}"
      style={s}
      id="main"
    >
      {@render children?.()}
    </main>
  {/snippet}
  {#snippet navbar({ style: s, class: c })}
    <Navbar class={c} style={s} />
  {/snippet}
  {#snippet suffix({ class: c })}
    <!--strange issue, proabably to do with dynamic components-->
    <!--the {#if} branch for InstanceCard is getting rendered even if site.data is null, causing crashes-->
    {#key site.data}
      {#if page.data.slots?.sidebar?.component}
        {@const SvelteComponent = page.data.slots.sidebar.component}
        <SvelteComponent
          {...page.data.slots.sidebar.props}
          class={[c, 'p-3 sm:p-6']}
        />
      {:else if site.data?.site_view}
        <InstanceCard
          site={site.data.site_view}
          taglines={site.data.taglines}
          admins={site.data.admins}
          version={site.data.version}
          class={[c, 'p-3 sm:p-6']}
        />
      {:else}
        <div class="h-64 w-full grid place-items-center">
          <Spinner width={32} />
        </div>
      {/if}
    {/key}
  {/snippet}
</Shell>
