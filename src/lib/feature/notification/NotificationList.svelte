<script lang="ts">
  import { afterNavigate, beforeNavigate } from '$app/navigation'
  import { onMount, tick, untrack } from 'svelte'
  import { t } from '$lib/app/state/i18n'
  import Placeholder from '$lib/ui/info/Placeholder.svelte'
  import { Button, Spinner } from '$lib/ui/kit'
  import {
    createNotificationList,
    type NotificationList,
    type NotificationListSnapshot,
  } from './list.svelte'
  import ReplyCard from './ReplyCard.svelte'
  import { notificationListReturn } from './return.svelte'
  import { notificationHref, notificationIdentity } from './rows'
  import UpvoteRow from './UpvoteRow.svelte'

  interface Props {
    /** The list saved when a row was followed, on a return from its thread. */
    restore?: NotificationListSnapshot
  }

  let { restore }: Props = $props()

  // Every other mount is a fresh entry: a new list loads page one, and its
  // reveal set lives only while the page is mounted.
  let list = $state.raw<NotificationList>()
  onMount(() => {
    const created = createNotificationList({ restore })
    list = created
    created.setMounted(true)
    return () => {
      created.setMounted(false)
      created.destroy()
    }
  })

  // Following a row's link saves the list for the return.
  beforeNavigate((navigation) => {
    const current = list
    const to = navigation.to?.url
    if (
      !current ||
      !to ||
      (navigation.type !== 'link' && navigation.type !== 'popstate')
    ) {
      return
    }
    // A restored list's target is where the followed row landed after its
    // redirect, which browser Forward goes back to.
    const followsRow =
      to.pathname === restore?.targetPath ||
      current.rows.some((row) => {
        const href = new URL(notificationHref(row), to)
        return href.pathname === to.pathname && href.search === to.search
      })
    if (!followsRow) return
    const snapshot = current.snapshot({
      scrollY: window.scrollY,
      targetPath: to.pathname,
    })
    if (snapshot) notificationListReturn.save(snapshot)
  })

  const scrollRestoreDeadlineMs = 500
  const scrollTolerancePx = 1
  let scrollRestoreDone = false
  let unmounted = false
  let scrollFrame: number | undefined

  /**
   * Scrolls to the saved offset once the rows are in the document, and again
   * on each frame until it holds or the deadline passes. Run from
   * `afterNavigate`, after Kit's own scroll handling.
   */
  async function restoreScroll(top: number): Promise<void> {
    await tick()
    if (unmounted) return
    const startedAt = performance.now()
    const attempt = (timestamp: DOMHighResTimeStamp) => {
      scrollFrame = undefined
      if (unmounted || timestamp - startedAt >= scrollRestoreDeadlineMs) return
      window.scrollTo({ top, behavior: 'instant' })
      if (Math.abs(window.scrollY - top) <= scrollTolerancePx) return
      scrollFrame = requestAnimationFrame(attempt)
    }
    attempt(startedAt)
  }

  afterNavigate(() => {
    if (restore === undefined || scrollRestoreDone) return
    scrollRestoreDone = true
    void restoreScroll(restore.scrollY)
  })

  onMount(() => () => {
    unmounted = true
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
  })

  // Infinite scroll is always on here, whatever `settings.infiniteScroll`
  // says: a sentinel below the rows loads the next page as it nears the view.
  let sentinel = $state<HTMLElement>()
  // The last state the observer reported. It reports changes only, so while
  // it stays true each settled page requests the next one.
  let intersecting = $state(false)

  $effect(() => {
    const element = sentinel
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries.at(-1)
        if (last) intersecting = last.isIntersecting
      },
      { rootMargin: '300px' },
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
      intersecting = false
    }
  })

  $effect(() => {
    const current = list
    // Read so a replaced page one re-runs this even when the cursor and the
    // later-page status come back unchanged (expiry, then the same owner).
    void current?.rows
    if (
      current &&
      intersecting &&
      current.cursor !== undefined &&
      current.laterPageStatus === 'idle' &&
      !current.pageOneLoading
    ) {
      untrack(() => current.loadMore())
    }
  })
</script>

{#if list}
  {#if list.rows.length > 0}
    <ol class="flex flex-col gap-3">
      {#each list.rows as row (notificationIdentity(row))}
        {@const identity = notificationIdentity(row)}
        <li>
          {#if row.reason === 'upvote'}
            <UpvoteRow
              {row}
              revealed={list.isRevealed(identity)}
              onreveal={list.reveal}
            />
          {:else}
            <ReplyCard
              {row}
              revealed={list.isRevealed(identity)}
              onreveal={list.reveal}
            />
          {/if}
        </li>
      {/each}
    </ol>
  {/if}

  {#if list.cursor !== undefined}
    <div bind:this={sentinel} aria-hidden="true"></div>
  {/if}

  {#if list.laterPageStatus === 'loading'}
    <div role="status" class="flex justify-center py-6">
      <span class="sr-only">{$t('routes.notifications.loadingMore')}</span>
      <!-- The kit Spinner is itself a status region; hide it so this region is the only one. -->
      <span aria-hidden="true"><Spinner width={24} /></span>
    </div>
  {:else if list.laterPageStatus === 'error'}
    <div class="flex flex-col items-start gap-2 py-3">
      <p role="alert">{$t('routes.notifications.loadFailed')}</p>
      <Button onclick={() => list?.retryLaterPage()}>
        {$t('message.retry')}
      </Button>
    </div>
  {/if}

  {#if list.status === 'loading'}
    <div class="flex justify-center py-6">
      <Spinner width={24} />
    </div>
  {:else if list.status === 'empty'}
    <Placeholder
      title={$t('routes.notifications.empty.title')}
      description={$t('routes.notifications.empty.description')}
      class="py-6"
    />
  {:else if list.status === 'error'}
    <div class="flex flex-col items-start gap-2">
      <p role="alert">{$t('routes.notifications.loadFailed')}</p>
      <Button onclick={() => list?.retry()}>
        {$t('message.retry')}
      </Button>
    </div>
  {/if}
{/if}
