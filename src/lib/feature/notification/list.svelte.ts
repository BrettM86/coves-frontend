import { tick, untrack } from 'svelte'
import { SvelteSet } from 'svelte/reactivity'
import { coves } from '$lib/api/client.svelte'
import { XrpcError } from '$lib/api/coves'
import { NSID } from '$lib/api/coves/client'
import type { ListNotificationsResponse } from '$lib/api/coves/types'
import { profile } from '$lib/app/state/auth.svelte'
import type { DID } from '$lib/types/atproto'
import { logNotificationFailure } from './log'
import { log } from '$lib/app/util/log'
import { type NotificationRow, parseNotificationRows, uniqueRows } from './rows'
import { createRequestEpoch, type RequestSnapshot } from './session'
import { laterPageIsRead, pageOneWatermark } from './timestamp'
import {
  type AcceptedUnreadRefresh,
  unreadNotifications,
} from './unread.svelte'

export type NotificationListStatus =
  'idle' | 'loading' | 'ready' | 'empty' | 'error'

export type LaterPageStatus = 'idle' | 'loading' | 'error'

export interface NotificationList {
  readonly status: NotificationListStatus
  readonly rows: readonly NotificationRow[]
  readonly cursor: string | undefined
  /** The page-one boundary, the raw server string. */
  readonly seenAt: string | undefined
  reveal(identity: string): void
  isRevealed(identity: string): boolean
  retry(): void
  /** Requests the page after the shown rows, unless one is in flight or failed. */
  loadMore(): void
  /** Clears a later-page failure and requests the same cursor again. */
  retryLaterPage(): void
  readonly laterPageStatus: LaterPageStatus
  /** A page-one load is in flight; `loadMore()` sends nothing until it settles. */
  readonly pageOneLoading: boolean
  /** Whether the list's component is mounted; displayed = mounted and visible. */
  setMounted(mounted: boolean): void
  /** The list as a return restores it; undefined while the list has no owner. */
  snapshot(place: NotificationListPlace): NotificationListSnapshot | undefined
  destroy(): void
}

/** Where the user was when a row was followed. */
export interface NotificationListPlace {
  readonly scrollY: number
  /** The pathname of the followed row's href. */
  readonly targetPath: string
}

/** A list saved when a row is followed, restored on the return. */
export interface NotificationListSnapshot {
  readonly owner: DID
  /** With their computed read state. */
  readonly rows: readonly NotificationRow[]
  /** Undefined when paging stopped or there is no more. */
  readonly cursor: string | undefined
  /** The page-one boundary, the raw server string. */
  readonly seenAt: string | undefined
  readonly requestedCursors: readonly string[]
  readonly recoveryArmed: boolean
  /** Revealed row identities. */
  readonly revealed: readonly string[]
  readonly scrollY: number
  readonly targetPath: string
}

/**
 * Why page one is loaded: first entry, the Retry button, the same owner back,
 * a reload trigger (a count rise or a return to the tab while displayed), or
 * a recovery from a later page the server rejected as `InvalidCursor`.
 */
type PageOneLoadKind =
  'initial' | 'retry' | 'owner-reload' | 'reload' | 'recovery'

/** The server rejected a later page's cursor. */
function isInvalidCursor(error: unknown): boolean {
  return (
    error instanceof XrpcError &&
    error.status === 400 &&
    error.errorName === 'InvalidCursor'
  )
}

/** What the list follows of the session. */
interface SessionState {
  /** The authenticated account's DID; undefined for a guest. */
  readonly did: DID | undefined
  readonly generation: string | undefined
  readonly expired: boolean
}

/**
 * Signed in for this list: authenticated with a server-stamped generation. A
 * hard load restores the profile from storage before the server session
 * arrives; until then `sessionGeneration` is undefined and nothing is sent.
 */
function signedIn(): boolean {
  return profile.isAuthenticated && profile.sessionGeneration !== undefined
}

/** Reads a response's cursor: only a string counts. */
function responseCursor(body: ListNotificationsResponse): string | undefined {
  return typeof body.cursor === 'string' ? body.cursor : undefined
}

/** Page one as the list keeps it. */
interface PageOne {
  readonly rows: NotificationRow[]
  readonly cursor: string | undefined
  readonly seenAt: string | undefined
}

/**
 * Reads page one from the unchecked response body: valid rows without
 * repeats, and the cursor and seenAt only when they are strings. Throws on a
 * body that is not an object.
 */
function parsePageOne(body: ListNotificationsResponse): PageOne {
  return {
    rows: uniqueRows(parseNotificationRows(body)),
    cursor: responseCursor(body),
    seenAt: typeof body.seenAt === 'string' ? body.seenAt : undefined,
  }
}

/** A later page as the list reads it, before dedup and read state. */
interface LaterPage {
  readonly rows: NotificationRow[]
  readonly cursor: string | undefined
}

/** Reads a later page; throws on a body that is not an object. */
function parseLaterPage(body: ListNotificationsResponse): LaterPage {
  return { rows: parseNotificationRows(body), cursor: responseCursor(body) }
}

/**
 * The notification list for the signed-in owner (the DID its rows were
 * requested under). The list generation advances on every owner transition
 * and at the start of every page-one load, and a response is applied only
 * when its generation is still current and the user is still signed in.
 * Expiry keeps what is shown; the same owner coming back reloads page one and
 * keeps the shown page until that succeeds; logout and a different owner clear
 * everything at once.
 */
export function createNotificationList(options?: {
  restore?: NotificationListSnapshot
}): NotificationList {
  let status = $state<NotificationListStatus>('idle')
  let rows = $state.raw<readonly NotificationRow[]>([])
  let cursor = $state<string>()
  let seenAt = $state<string>()
  const revealed = new SvelteSet<string>()
  const generation = createRequestEpoch()
  // The DID the shown rows (or the load in flight) belong to.
  let owner: DID | undefined
  // The session generation the owner was last seen signed in under.
  let ownerSessionGeneration: string | undefined
  // The session expired since the owner was last seen signed in.
  let expiredSinceSeen = false
  let destroyed = false
  let mounted = false
  // The updateSeen owed by the last accepted page-one load: the list
  // generation it was requested under and page one's watermark.
  let pendingMark:
    | { readonly snapshot: RequestSnapshot; readonly watermark: string }
    | undefined
  let laterPageStatus = $state<LaterPageStatus>('idle')
  // Moves on whenever the list generation moves or page one is replaced, so a
  // later page sent before that is discarded.
  let laterPageEpoch = 0
  // Every cursor requested since page one was shown; a response repeating one
  // stops paging.
  let requestedCursors: string[] = []
  // The list generation of the page-one load in flight; a load whose
  // generation has moved no longer holds it. State, so paging resumes when it
  // settles even if nothing shown changes (a failed reload).
  let pageOneLoad = $state.raw<RequestSnapshot>()
  // What the page-one load in flight is for; read only while it is current.
  let pageOneLoadKind: PageOneLoadKind | undefined
  // One reload waits behind the page-one load in flight; owner transitions
  // (not a same-session profile change) drop it.
  let reloadQueued = false
  // The unread count last seen while displayed; a rise above it reloads.
  // Undefined after an owner transition: the next accepted refresh only
  // records it.
  let lastObservedCount: number | undefined = unreadNotifications.count
  // The document came back to visible; the next accepted refresh reloads
  // when it reports any unread item.
  let returnedToVisible = false
  // An InvalidCursor may start one recovery page-one load. Spent by every
  // recovery; re-armed by the later-page Retry, a page one loaded for any
  // other reason, and an owner reset.
  let recoveryArmed = true
  // The later-page failure shown is a failed recovery: its Retry loads page
  // one again instead of re-sending the cursor.
  let retryRecovery = false
  // A restored list has shown no page one of its own yet: a return to the
  // tab does not reload it on its own, only a count rise does.
  let awaitingOwnPageOne = false

  /** Forgets later-page requests: in flight, failed and requested cursors. */
  function resetLaterPages(): void {
    laterPageEpoch++
    laterPageStatus = 'idle'
    retryRecovery = false
    requestedCursors = []
  }

  /** Moves the list generation on; responses sent before it are discarded. */
  function advanceGeneration(): void {
    generation.advance()
    resetLaterPages()
  }

  function displayed(): boolean {
    return mounted && document.visibilityState === 'visible'
  }

  /**
   * Sends the pending mark once page one is in the DOM and displayed. A mark
   * whose generation has moved is dropped; one not yet displayed waits for
   * the next mount or visible transition. It is consumed when sent, so a
   * failure is logged and never retried.
   */
  async function markSeen(): Promise<void> {
    const mark = pendingMark
    if (mark === undefined || !displayed()) return
    await tick()
    if (pendingMark !== mark) return
    if (!generation.isCurrent(mark.snapshot) || !signedIn()) {
      pendingMark = undefined
      return
    }
    if (!displayed()) return
    pendingMark = undefined
    coves()
      .updateNotificationsSeen({ seenAt: mark.watermark })
      .then(
        () => unreadNotifications.refresh(),
        (error: unknown) =>
          logNotificationFailure(NSID.updateNotificationsSeen, error),
      )
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === 'visible') returnedToVisible = true
    void markSeen()
  }
  document.addEventListener('visibilitychange', handleVisibilityChange)

  /** Drops everything owned by the previous owner. */
  function reset(): void {
    advanceGeneration()
    rows = []
    cursor = undefined
    seenAt = undefined
    revealed.clear()
    status = 'idle'
    recoveryArmed = true
    awaitingOwnPageOne = false
  }

  function applyPageOne(page: PageOne): void {
    awaitingOwnPageOne = false
    resetLaterPages()
    rows = page.rows
    // Taken as sent: an omitted value replaces the old one with undefined.
    cursor = page.cursor
    seenAt = page.seenAt
    status = rows.length > 0 ? 'ready' : 'empty'
  }

  function pageOneInFlight(): boolean {
    return pageOneLoad !== undefined && generation.isCurrent(pageOneLoad)
  }

  /** Releases the page-one latch and runs the queued reload, if any. */
  function finishPageOneLoad(): void {
    pageOneLoad = undefined
    if (!reloadQueued) return
    reloadQueued = false
    loadPageOne('reload')
  }

  // Every kind shares this path; a reload or owner reload keeps the shown
  // page (and its status) until it succeeds, which `rows.length` already
  // expresses. A reload while a page-one load is in flight waits behind it.
  function loadPageOne(kind: PageOneLoadKind): void {
    if (destroyed || !signedIn()) return
    if (kind === 'reload' && pageOneInFlight()) {
      reloadQueued = true
      return
    }
    if (kind === 'recovery') recoveryArmed = false
    advanceGeneration()
    const snapshot = generation.snapshot()
    pageOneLoad = snapshot
    pageOneLoadKind = kind
    // A recovery keeps the shown status: its failure is a later-page failure.
    if (rows.length === 0 && kind !== 'recovery') status = 'loading'
    coves()
      .listNotifications({})
      // Parsed before it is applied, so a malformed body fails like a request.
      .then(parsePageOne)
      .then(
        (page) => {
          // A completion from an earlier generation changes nothing.
          if (!generation.isCurrent(snapshot) || !signedIn()) return
          applyPageOne(page)
          if (kind !== 'recovery') recoveryArmed = true
          const watermark = pageOneWatermark(page.rows)
          pendingMark =
            watermark === undefined ? undefined : { snapshot, watermark }
          void markSeen()
          finishPageOneLoad()
        },
        (error: unknown) => {
          // A 401 expires the session in `covesCustomFetch` before this
          // handler runs, so the generation has moved and it is dropped.
          if (!generation.isCurrent(snapshot) || !signedIn()) return
          logNotificationFailure(NSID.listNotifications, error)
          if (kind === 'recovery') {
            // The shown rows stay; the later-page Retry tries page one again.
            laterPageStatus = 'error'
            retryRecovery = true
          } else if (rows.length === 0) status = 'error'
          finishPageOneLoad()
        },
      )
  }

  /**
   * Appends a later page: rows already shown are dropped (the first shown
   * wins), and each row's read state is judged against page one's raw seenAt.
   * A cursor already requested in this list stops paging.
   */
  function applyLaterPage(page: LaterPage): void {
    const pageOneSeenAt = seenAt
    // Replaced, never mutated: the parsed rows may be the response's objects.
    const incoming = page.rows.map((row) => ({
      ...row,
      isRead: laterPageIsRead(row, pageOneSeenAt),
    }))
    rows = uniqueRows([...rows, ...incoming])
    // Page one may have had no rows but a cursor.
    if (rows.length > 0) status = 'ready'
    const next = page.cursor
    if (next !== undefined && requestedCursors.includes(next)) {
      // The cursor is left out: it can identify the account's position.
      log.warn('Notification cursor repeated; paging stopped', undefined, {
        nsid: NSID.listNotifications,
      })
      cursor = undefined
      return
    }
    cursor = next
  }

  function loadLaterPage(): void {
    const requested = cursor
    // The cursor belongs to the page a page-one load in flight replaces.
    if (
      destroyed ||
      !signedIn() ||
      pageOneInFlight() ||
      requested === undefined ||
      laterPageStatus !== 'idle' ||
      requestedCursors.includes(requested)
    ) {
      return
    }
    const snapshot = generation.snapshot()
    const epoch = laterPageEpoch
    const isCurrent = () =>
      epoch === laterPageEpoch && generation.isCurrent(snapshot) && signedIn()
    requestedCursors.push(requested)
    laterPageStatus = 'loading'
    coves()
      .listNotifications({ cursor: requested })
      // Parsed before it is applied, so a malformed body fails like a request.
      .then(parseLaterPage)
      .then(
        (page) => {
          if (!isCurrent()) return
          applyLaterPage(page)
          laterPageStatus = 'idle'
        },
        (error: unknown) => {
          if (!isCurrent()) return
          logNotificationFailure(NSID.listNotifications, error)
          if (isInvalidCursor(error) && recoveryArmed) loadPageOne('recovery')
          else laterPageStatus = 'error'
        },
      )
  }

  /**
   * Drops what the reload triggers hold for the previous session: its queued
   * reload, its last observed count and its return to visible.
   */
  function forgetReloadTriggers(): void {
    reloadQueued = false
    lastObservedCount = undefined
    returnedToVisible = false
  }

  function followSession(session: SessionState): void {
    if (session.expired) {
      forgetReloadTriggers()
      // Keep the shown rows and send nothing; no spinner, error or empty
      // state while expired.
      advanceGeneration()
      expiredSinceSeen = true
      if (rows.length === 0) status = 'idle'
      return
    }
    if (session.did === undefined) {
      forgetReloadTriggers()
      owner = undefined
      ownerSessionGeneration = undefined
      expiredSinceSeen = false
      reset()
      return
    }
    // A different account clears at once, even before its generation is known.
    if (owner !== undefined && session.did !== owner) {
      forgetReloadTriggers()
      owner = undefined
      ownerSessionGeneration = undefined
      expiredSinceSeen = false
      reset()
    }
    // Restored from storage before the server stamped a generation.
    if (session.generation === undefined) return
    const sameOwnerBack =
      owner === session.did &&
      (expiredSinceSeen || ownerSessionGeneration !== session.generation)
    const firstOwner = owner === undefined
    owner = session.did
    ownerSessionGeneration = session.generation
    expiredSinceSeen = false
    if (firstOwner) loadPageOne('initial')
    else if (sameOwnerBack) {
      forgetReloadTriggers()
      awaitingOwnPageOne = false
      loadPageOne('owner-reload')
    }
  }

  /**
   * While displayed, an accepted refresh reloads page one when its count is
   * above the last observed one, or when it is the first since the document
   * returned to visible and reports any unread item; at most one reload each.
   * Without a return, the first after an owner transition only records the
   * count.
   */
  function handleAcceptedRefresh(refresh: AcceptedUnreadRefresh): void {
    if (destroyed || !displayed()) return
    const rose =
      lastObservedCount !== undefined && refresh.count > lastObservedCount
    // Owner transitions clear the return, so it needs no recorded count.
    const returned =
      !awaitingOwnPageOne && returnedToVisible && refresh.count > 0
    lastObservedCount = refresh.count
    returnedToVisible = false
    if (rose || returned) loadPageOne('reload')
  }
  const unsubscribeAcceptedRefresh = unreadNotifications.onAcceptedRefresh(
    handleAcceptedRefresh,
  )

  /**
   * Starts from a saved list as the session stands now, so the first session
   * run is neither a first owner nor the same owner back: nothing is sent,
   * nothing is marked and no reload is queued.
   */
  function restoreFrom(saved: NotificationListSnapshot): void {
    advanceGeneration()
    rows = [...saved.rows]
    cursor = saved.cursor
    seenAt = saved.seenAt
    for (const identity of saved.revealed) revealed.add(identity)
    requestedCursors = [...saved.requestedCursors]
    recoveryArmed = saved.recoveryArmed
    status = rows.length > 0 ? 'ready' : 'empty'
    owner = saved.owner
    ownerSessionGeneration = profile.sessionGeneration
    expiredSinceSeen = profile.sessionExpired
    awaitingOwnPageOne = true
  }
  if (options?.restore !== undefined) restoreFrom(options.restore)

  /**
   * The list as plain data. Paging in flight or failed is not carried: its
   * cursor is left requestable, so the restored list can ask for it again.
   */
  function snapshot(
    place: NotificationListPlace,
  ): NotificationListSnapshot | undefined {
    if (owner === undefined) return undefined
    const pending = cursor !== undefined && laterPageStatus !== 'idle'
    return {
      owner,
      rows: [...rows],
      cursor,
      seenAt,
      requestedCursors: pending
        ? requestedCursors.filter((requested) => requested !== cursor)
        : [...requestedCursors],
      // A recovery in flight or failed is not carried, so its arm is not
      // spent: the saved cursor's InvalidCursor recovers once more.
      recoveryArmed:
        recoveryArmed ||
        retryRecovery ||
        (pageOneInFlight() && pageOneLoadKind === 'recovery'),
      revealed: [...revealed],
      scrollY: place.scrollY,
      targetPath: place.targetPath,
    }
  }

  const destroyRoot = $effect.root(() => {
    const session = $derived<SessionState>({
      did:
        profile.current.type === 'authenticated'
          ? profile.current.did
          : undefined,
      generation: profile.sessionGeneration,
      expired: profile.sessionExpired,
    })
    $effect(() => {
      const observed = session
      untrack(() => followSession(observed))
    })
  })

  return {
    get status() {
      return status
    },
    get rows() {
      return rows
    },
    get cursor() {
      return cursor
    },
    get seenAt() {
      return seenAt
    },
    reveal(identity) {
      revealed.add(identity)
    },
    isRevealed(identity) {
      return revealed.has(identity)
    },
    retry() {
      loadPageOne('retry')
    },
    loadMore() {
      loadLaterPage()
    },
    retryLaterPage() {
      if (laterPageStatus !== 'error') return
      if (retryRecovery) {
        loadPageOne('recovery')
        return
      }
      if (cursor === undefined) return
      recoveryArmed = true
      const failed = cursor
      requestedCursors = requestedCursors.filter(
        (requested) => requested !== failed,
      )
      laterPageStatus = 'idle'
      loadLaterPage()
    },
    get laterPageStatus() {
      return laterPageStatus
    },
    get pageOneLoading() {
      return pageOneInFlight()
    },
    setMounted(next) {
      mounted = next
      if (mounted) void markSeen()
    },
    snapshot,
    destroy() {
      destroyed = true
      pendingMark = undefined
      reloadQueued = false
      unsubscribeAcceptedRefresh()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      destroyRoot()
      advanceGeneration()
    },
  }
}
