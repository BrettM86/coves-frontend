<script lang="ts">
  import { browser } from '$app/environment'
  import { navigating, page } from '$app/state'
  import { profile } from '$lib/app/state/auth.svelte'
  import { locale, t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import { getDefaultColors } from '$lib/app/state/theme/presets'
  import {
    inDarkColorScheme,
    rgbToHex,
    theme,
  } from '$lib/app/state/theme/theme.svelte'
  import CovesSidebar from '$lib/feature/instance/CovesSidebar.svelte'
  import Markdown from '$lib/feature/markdown/Markdown.svelte'
  import ModerationModals from '$lib/feature/moderation/ModerationModals.svelte'

  import ExpandableImage from '$lib/ui/generic/ExpandableImage.svelte'
  import { Shell } from '$lib/ui/layout'
  import Navbar from '$lib/feature/shell/navbar/Navbar.svelte'
  import Sidebar from '$lib/feature/shell/Sidebar.svelte'
  import { Button, ModalContainer, toast, ToastContainer } from '$lib/ui/kit'
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

  onMount(() => {
    if (browser) {
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

  // Tell the user their session ended rather than letting them discover it by
  // being silently logged out. hooks.server.ts deletes the stale cookie and
  // sets locals.sessionExpired on a 401 from /api/me; +layout.server.ts
  // forwards it as page.data.sessionExpired.
  //
  // The latch is REQUIRED, not defensive. The root layout's server load reads
  // only `request` and `locals` — no params, no url, no depends() — so plain
  // client-side navigations never re-run it: page.data.sessionExpired stays
  // true (and this effect re-runs on each one) until something re-runs the
  // load — an invalidateAll navigation (every sort/search change via
  // searchParam()), a form action, or a full reload. Without the latch that
  // is a toast on every navigation in between.
  let notifiedSessionExpired = false
  $effect(() => {
    if (page.data.sessionExpired) {
      if (!notifiedSessionExpired) {
        notifiedSessionExpired = true
        toast({ content: $t('toast.sessionExpired'), type: 'warning' })
      }
    } else {
      notifiedSessionExpired = false
    }
  })

  // Surface auth infrastructure failures from hooks.server.ts (mirrors the
  // sessionExpired handling above): the backend couldn't be reached to
  // validate the session, so the user may appear logged out even though their
  // session cookie is preserved. Warn once per outage rather than on every
  // navigation while the backend stays unreachable.
  let notifiedAuthNetworkError = false
  $effect(() => {
    if (page.data.authError === 'network_error') {
      if (!notifiedAuthNetworkError) {
        notifiedAuthNetworkError = true
        toast({ content: $t('toast.serverUnreachable'), type: 'warning' })
      }
    } else {
      notifiedAuthNetworkError = false
    }
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
  <meta
    name="theme-color"
    content={rgbToHex(
      theme.colorScheme && inDarkColorScheme()
        ? (theme.current.colors.zinc?.[925] ?? getDefaultColors().zinc[925])
        : (theme.current.colors.slate?.[25] ?? getDefaultColors().slate[25]),
    )}
  />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <meta
    name="description"
    content="Coves — community forums on the atmosphere"
  />
</svelte:head>

<Button
  class="fixed -top-16 focus:top-0 left-0 m-4 z-300 transition-all"
  href="#main"
  icon={Forward}
>
  Skip Navigation
</Button>

<Shell>
  <ToastContainer>
    {#snippet content(toast)}
      <Markdown
        source={toast.content}
        class={toast.long ? 'text-[15px]' : 'text-sm font-medium'}
      />
    {/snippet}
  </ToastContainer>
  <ExpandableImage />
  <ModalContainer closeLabel={$t('common.back')} />
  <ModerationModals />

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
    {#if page.data.slots?.sidebar?.component}
      {@const SvelteComponent = page.data.slots.sidebar.component}
      <SvelteComponent
        {...page.data.slots.sidebar.props}
        class={[c, 'p-3 sm:p-6']}
      />
    {:else}
      <CovesSidebar class={[c, 'p-3 sm:p-6']} />
    {/if}
  {/snippet}
</Shell>
