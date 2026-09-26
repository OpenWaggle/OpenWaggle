import {
  loadReadingPositions,
  rememberReadingPosition,
  type SavedReadingPosition,
  saveReadingPositions,
} from './transcript-reading-positions'
import { NEAR_BOTTOM_PX, TranscriptViewportController } from './transcript-viewport-controller'
import {
  createDomViewportGeometry,
  TRANSCRIPT_ROW_KEY_ATTRIBUTE,
} from './transcript-viewport-geometry'

/** A disclosure hold ends once the toggled content stops resizing for this long. */
const HOLD_SETTLE_MS = 300
const SAVE_DEBOUNCE_MS = 150
const SCROLLBAR_HIDE_DELAY_MS = 800
/** How long a saved position may wait for hydration to mount its row. */
const RESTORE_GRACE_MS = 1500
const UPWARD_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])
const TOUCH_INTENT_PX = 1

interface TouchPositionEvent {
  readonly touches: ArrayLike<{ readonly clientY: number }>
}
const DISCLOSURE_SELECTOR = 'button, summary, [role="button"], [aria-expanded]'

let sharedPositions: Map<string, SavedReadingPosition> | null = null
function readingPositions() {
  sharedPositions ??= loadReadingPositions()
  return sharedPositions
}

/** The saved reading position for a Session branch, read before the viewport mounts. */
export function savedReadingPosition(positionKey: string) {
  return readingPositions().get(positionKey) ?? null
}

export interface TranscriptViewportView {
  readonly setShowScrollToBottom: (visible: boolean) => void
  readonly setShowScrollbar: (visible: boolean) => void
  /** The row a pending restore is waiting for, so the window can be built around it. */
  readonly setPendingRestoreKey: (key: string | null) => void
  /** Whether the reader follows the live end, so the window can be bounded during render. */
  readonly setFollowing: (following: boolean) => void
}

type Timer = ReturnType<typeof setTimeout>

/**
 * One mounted transcript viewport: its elements, controller, timers, and saved reading position.
 *
 * Held for the component's lifetime, so effects and handlers can call it without re-subscribing
 * on every render. The component is keyed by Session and branch, which scopes one instance to one
 * reading position (ADR 0036).
 */
export class TranscriptViewportSession {
  readonly controller: TranscriptViewportController
  readonly savedPosition: SavedReadingPosition
  scroller: HTMLElement | null = null
  content: HTMLElement | null = null
  endSpace: HTMLElement | null = null
  private pendingRestore: { position: SavedReadingPosition; deadline: number } | null = null
  private restoreArmed = false
  private skipNextLayout = false
  /*
   * The position to save, captured while the DOM is live. Reading it at unmount measured a
   * detached scroller as resting at the end and saved every position as "following".
   */
  private lastPosition: SavedReadingPosition = null
  private lastTouchY: number | null = null
  private holdTimer: Timer | null = null
  private saveTimer: Timer | null = null
  private scrollbarTimer: Timer | null = null

  constructor(
    private readonly positionKey: string,
    private readonly view: TranscriptViewportView,
  ) {
    this.savedPosition = savedReadingPosition(positionKey)
    this.lastPosition = this.savedPosition
    this.controller = new TranscriptViewportController(
      createDomViewportGeometry({
        scroller: () => this.scroller,
        content: () => this.content,
        endSpace: () => this.endSpace,
      }),
    )
  }

  attach(part: 'scroller' | 'content' | 'endSpace', element: HTMLElement | null) {
    this[part] = element
  }

  /** DOM handlers for the scroller element. */
  readonly scrollerHandlers = {
    onScroll: () => this.scrolled(),
    onWheel: (event: { readonly deltaY: number }) => this.wheel(event.deltaY),
    onTouchStart: (event: TouchPositionEvent) => this.touchStarted(event.touches[0]?.clientY),
    onTouchMove: (event: TouchPositionEvent) => this.touchMoved(event.touches[0]?.clientY),
    onTouchEnd: () => this.touchStarted(undefined),
    onPointerDown: (event: { readonly target: EventTarget; readonly currentTarget: EventTarget }) =>
      this.pointerDown(event.target, event.currentTarget),
    onKeyDown: (event: { readonly key: string }) => this.keyDown(event.key),
    onClickCapture: (event: { readonly target: EventTarget }) => this.clickCaptured(event.target),
  }

  /** Keys of the rows currently intersecting the viewport. */
  visibleRowKeys(): ReadonlySet<string> {
    const keys = new Set<string>()
    const scroller = this.scroller
    const content = this.content
    if (!scroller || !content) return keys
    const bounds = scroller.getBoundingClientRect()
    for (const row of content.querySelectorAll<HTMLElement>(`[${TRANSCRIPT_ROW_KEY_ATTRIBUTE}]`)) {
      const rect = row.getBoundingClientRect()
      if (rect.top >= bounds.bottom) break
      const key = row.getAttribute(TRANSCRIPT_ROW_KEY_ATTRIBUTE)
      if (key && rect.bottom > bounds.top) keys.add(key)
    }
    return keys
  }

  /** Arms the saved-position restore once rows exist; hydration may still be arriving. */
  armRestore() {
    if (this.restoreArmed) return
    this.restoreArmed = true
    this.pendingRestore = { position: this.savedPosition, deadline: Date.now() + RESTORE_GRACE_MS }
    this.view.setPendingRestoreKey(this.savedPosition?.key ?? null)
  }

  /**
   * Skips re-applying the mode for the current commit, which is about to be replaced before paint.
   *
   * A turn the reader is inside settles folded for one unpainted commit before it is re-expanded;
   * applying that commit would hand the anchor to whichever row the fold left under the viewport.
   */
  skipLayoutForThisCommit() {
    this.skipNextLayout = true
  }

  /** Tells the controller whether newer rows exist beyond the mounted window. */
  setWindowHasLater(hasLater: boolean) {
    this.controller.setWindowHasLater(hasLater)
  }

  /** Re-applies the viewport mode. Called before paint after every commit and resize. */
  layout() {
    if (this.skipNextLayout) {
      this.skipNextLayout = false
      return
    }
    this.tryRestore()
    this.controller.applyLayout()
    this.capturePosition()
    this.syncButton()
  }

  private capturePosition() {
    // Until a pending restore lands, the saved position is still the reader's position.
    if (this.pendingRestore !== null || !this.scroller?.isConnected) return
    this.lastPosition = this.controller.readingPosition()
  }

  resized() {
    this.layout()
    if (this.holdTimer) this.scheduleHoldRelease()
  }

  scrolled() {
    this.controller.handleScroll()
    this.capturePosition()
    this.syncButton()
    this.persistSoon()
    this.view.setShowScrollbar(true)
    if (this.scrollbarTimer) clearTimeout(this.scrollbarTimer)
    this.scrollbarTimer = setTimeout(
      () => this.view.setShowScrollbar(false),
      SCROLLBAR_HIDE_DELAY_MS,
    )
  }

  wheel(deltaY: number) {
    if (deltaY < 0) this.leaveLiveEnd()
    else this.interrupt()
  }

  touchStarted(clientY: number | undefined) {
    this.lastTouchY = clientY ?? null
  }

  /**
   * A finger moving down scrolls the transcript up: leave the live end before the next layout,
   * or a stream's next token could snap the view back between the touch and its scroll event.
   */
  touchMoved(clientY: number | undefined) {
    this.interrupt()
    if (clientY === undefined) return
    const previous = this.lastTouchY
    this.lastTouchY = clientY
    if (previous !== null && clientY > previous + TOUCH_INTENT_PX) this.leaveLiveEnd()
  }

  pointerDown(target: EventTarget, currentTarget: EventTarget) {
    // A press on the scroller itself, rather than its content, is a scrollbar drag.
    if (target === currentTarget) this.leaveLiveEnd()
  }

  keyDown(key: string) {
    if (UPWARD_KEYS.has(key)) this.leaveLiveEnd()
  }

  /** Holds the toggled row still while a disclosure changes height (ADR 0036). */
  clickCaptured(target: EventTarget) {
    if (!(target instanceof Element) || !target.closest(DISCLOSURE_SELECTOR)) return
    const key = target
      .closest(`[${TRANSCRIPT_ROW_KEY_ATTRIBUTE}]`)
      ?.getAttribute(TRANSCRIPT_ROW_KEY_ATTRIBUTE)
    if (!key) return
    this.interrupt()
    this.controller.hold(key)
    this.scheduleHoldRelease()
  }

  scrollToBottom() {
    this.interrupt()
    this.controller.follow()
    this.syncButton()
  }

  anchorNewTurn(key: string) {
    this.interrupt()
    this.controller.anchorNewTurn(key)
    this.syncButton()
  }

  releaseNewTurn() {
    this.controller.releaseNewTurn()
    this.syncButton()
  }

  dispose() {
    for (const timer of [this.holdTimer, this.saveTimer, this.scrollbarTimer]) {
      if (timer) clearTimeout(timer)
    }
    this.persist()
  }

  private leaveLiveEnd() {
    this.interrupt()
    this.controller.leaveLiveEnd()
    this.syncButton()
  }

  /** Any reader action supersedes a restore still waiting for its row. */
  private interrupt() {
    this.settleRestore()
  }

  private settleRestore() {
    if (this.pendingRestore === null) return
    this.pendingRestore = null
    this.view.setPendingRestoreKey(null)
  }

  private tryRestore() {
    const pending = this.pendingRestore
    if (!pending) return
    if (pending.position === null || Date.now() > pending.deadline) {
      this.settleRestore()
      return
    }
    if (this.controller.hasMountedRow(pending.position.key)) {
      this.settleRestore()
      this.controller.restore(pending.position)
    }
  }

  private syncButton() {
    this.view.setFollowing(this.controller.isFollowing)
    // Mirrors the mode for tests and diagnosis; written directly, so it costs no render.
    const mode = this.controller.mode
    if (this.scroller) {
      this.scroller.dataset.transcriptMode =
        mode.kind === 'following' ? mode.kind : `${mode.kind}:${mode.key}`
    }
    this.view.setShowScrollToBottom(
      !this.controller.isFollowing && this.controller.distanceToBottom() > NEAR_BOTTOM_PX,
    )
  }

  private scheduleHoldRelease() {
    if (this.holdTimer) clearTimeout(this.holdTimer)
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null
      this.controller.releaseHold()
      this.syncButton()
    }, HOLD_SETTLE_MS)
  }

  private persist() {
    rememberReadingPosition(readingPositions(), this.positionKey, this.lastPosition)
    saveReadingPositions(readingPositions())
  }

  private persistSoon() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.persist()
    }, SAVE_DEBOUNCE_MS)
  }
}
