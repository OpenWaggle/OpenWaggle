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
const DISCLOSURE_SELECTOR = 'button, summary, [role="button"], [aria-expanded]'

let sharedPositions: Map<string, SavedReadingPosition> | null = null
function readingPositions() {
  sharedPositions ??= loadReadingPositions()
  return sharedPositions
}

export interface TranscriptViewportView {
  readonly setShowScrollToBottom: (visible: boolean) => void
  readonly setShowScrollbar: (visible: boolean) => void
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
  private holdTimer: Timer | null = null
  private saveTimer: Timer | null = null
  private scrollbarTimer: Timer | null = null

  constructor(
    private readonly positionKey: string,
    private readonly view: TranscriptViewportView,
  ) {
    this.savedPosition = readingPositions().get(positionKey) ?? null
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
    onTouchMove: () => this.touched(),
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

  /** Re-applies the viewport mode. Called before paint after every commit and resize. */
  layout() {
    if (this.skipNextLayout) {
      this.skipNextLayout = false
      return
    }
    this.tryRestore()
    this.controller.applyLayout()
    this.syncButton()
  }

  resized() {
    this.layout()
    if (this.holdTimer) this.scheduleHoldRelease()
  }

  scrolled() {
    this.controller.handleScroll()
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

  touched() {
    this.interrupt()
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
    this.pendingRestore = null
  }

  private tryRestore() {
    const pending = this.pendingRestore
    if (!pending) return
    if (pending.position === null || Date.now() > pending.deadline) {
      this.pendingRestore = null
      return
    }
    if (this.controller.hasMountedRow(pending.position.key)) {
      this.pendingRestore = null
      this.controller.restore(pending.position)
    }
  }

  private syncButton() {
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
    rememberReadingPosition(readingPositions(), this.positionKey, this.controller.readingPosition())
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
