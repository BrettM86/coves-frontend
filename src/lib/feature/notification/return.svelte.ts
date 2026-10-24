import { browser } from '$app/environment'
import { navigating } from '$app/state'
import type { AfterNavigate, BeforeNavigate } from '@sveltejs/kit'
import { untrack } from 'svelte'
import { profile } from '$lib/app/state/auth.svelte'
import type { DID } from '$lib/types/atproto'
import type { NotificationListSnapshot } from './list.svelte'

const notificationsPath = '/notifications'

/** The authenticated account's DID; undefined for a guest. */
function authenticatedDid(): DID | undefined {
  return profile.current.type === 'authenticated'
    ? profile.current.did
    : undefined
}

/**
 * The one list saved when a row was followed, kept in memory until the
 * return. Only Back or the bell from the followed row's thread restores it;
 * logout and another account drop it at once, expiry keeps it.
 */
/**
 * Whether `a` and `b` name the same record on route `routeId`: every path
 * segment matches except the actor and community names, which a thread
 * loader rewrites from a DID to its handle.
 */
function sameRecord(routeId: string, a: string, b: string): boolean {
  const routeSegments = routeId
    .split('/')
    .filter((segment) => !/^\(.*\)$/.test(segment))
  const aSegments = a.split('/')
  const bSegments = b.split('/')
  if (
    aSegments.length !== routeSegments.length ||
    bSegments.length !== routeSegments.length
  )
    return false
  return routeSegments.every(
    (segment, index) =>
      /^\[\w+=(actor|handle)\]$/.test(segment) ||
      aSegments[index] === bSegments[index],
  )
}

function createNotificationListReturn() {
  let saved: NotificationListSnapshot | undefined
  // The navigation into /notifications is a return to the saved list.
  let marked = false
  let started = false
  // The destination of the last navigation `beforeNavigate` saw. Kit runs
  // no `beforeNavigate` for a loader redirect or for a navigation started
  // while another one loads.
  let lastNoted: { path: string; routeId: string | null } | undefined

  function drop(): void {
    saved = undefined
    marked = false
  }

  /** Drops a save the session no longer belongs to. */
  function followSession(session: {
    readonly authenticated: boolean
    readonly expired: boolean
    readonly did: DID | undefined
  }): void {
    if (saved === undefined || session.expired) return
    if (!session.authenticated || session.did !== saved.owner) drop()
  }

  /**
   * Kit's in-progress navigation is Back or the bell from the target. Covers
   * a bell that interrupted a loading navigation on the thread (a comment
   * sort), which ran no `beforeNavigate`.
   */
  function returnInProgress(): boolean {
    return (
      saved !== undefined &&
      (navigating.type === 'popstate' || navigating.type === 'link') &&
      navigating.to?.url.pathname === notificationsPath &&
      navigating.from?.url.pathname === saved.targetPath
    )
  }

  return {
    /** Starts the owner watcher; once, in the browser only. */
    start(): void {
      if (!browser || started) return
      started = true
      $effect.root(() => {
        $effect(() => {
          const session = {
            authenticated: profile.isAuthenticated,
            expired: profile.sessionExpired,
            did: authenticatedDid(),
          }
          untrack(() => followSession(session))
        })
      })
    },

    save(snapshot: NotificationListSnapshot): void {
      saved = snapshot
      marked = false
    },

    /** Called for every `beforeNavigate`. */
    noteNavigation(navigation: Pick<BeforeNavigate, 'type' | 'to'>): void {
      lastNoted = navigation.to
        ? { path: navigation.to.url.pathname, routeId: navigation.to.route.id }
        : undefined
      if (saved === undefined) return
      const path = navigation.to?.url.pathname
      // The outbound navigation itself, or a query or hash change on the
      // thread.
      if (path === saved.targetPath) return
      if (
        path === notificationsPath &&
        (navigation.type === 'popstate' || navigation.type === 'link')
      ) {
        marked = true
        return
      }
      drop()
    },

    /**
     * Called for every `afterNavigate`. The followed row's navigation may
     * land on another path naming the same record (the thread loaders
     * redirect a DID owner to its handle): that path becomes the target. A
     * Back or link that interrupted the row's loading navigation lands on
     * another record and is not mistaken for that redirect. Any other landing
     * off the target drops the save, since Kit noted no `beforeNavigate` for
     * a navigation that interrupted a loading one.
     */
    noteArrival(navigation: Pick<AfterNavigate, 'from' | 'to'>): void {
      if (saved === undefined || !navigation.to) return
      const path = navigation.to.url.pathname
      if (path === saved.targetPath) return
      const redirectedRow =
        navigation.from?.url.pathname === notificationsPath &&
        lastNoted?.path === saved.targetPath &&
        lastNoted.routeId !== null &&
        lastNoted.routeId === navigation.to.route.id &&
        sameRecord(lastNoted.routeId, lastNoted.path, path)
      if (redirectedRow) {
        saved = { ...saved, targetPath: path }
        return
      }
      drop()
    },

    /** The save for this return, if any; the store is empty afterwards. */
    take(): NotificationListSnapshot | undefined {
      const taken = marked || returnInProgress() ? saved : undefined
      drop()
      if (taken === undefined) return undefined
      // An expired session has no DID; the watcher kept the save through it.
      if (profile.sessionExpired || authenticatedDid() === taken.owner)
        return taken
      return undefined
    },
  }
}

export const notificationListReturn = createNotificationListReturn()
