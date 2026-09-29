import { measureSentTurn, reservedSpaceFor, type SentTurn } from './transcript-sent-turn'
import type { ViewportGeometry } from './transcript-viewport-geometry'

/**
 * Where the transcript viewport goes when its content or size changes (ADR 0036).
 *
 * One rule covers every height change: the row the reader is looking at does not move. Loading
 * earlier rows, a turn folding above the reader, a disclosure being toggled, the composer growing,
 * and a restored reading position all resolve to one of three modes:
 *
 * - `following`: pinned to the live end.
 * - `anchored`: a row, identified by key, is held at a fixed offset from the viewport top.
 * - `new-turn`: the message just sent is held near the top while its reply streams in below.
 *
 * A sent turn is held until its content reaches the bottom of the viewport, the way the Codex
 * desktop app does. A turn doing work (tool calls, a Waggle turn) when it gets there is followed;
 * a plain answer keeps its message in place and continues below the fold, even if work starts
 * later. Scrolling at any point stops that; scrolling down to the live end follows again.
 *
 * DOM access goes through `ViewportGeometry` so the rules are testable without layout.
 */

export const NEAR_BOTTOM_PX = 64
/** Where a sent message prefers to settle, below the transcript's top fade. */
export const NEW_TURN_TOP_OFFSET_PX = 24
const SCROLL_ECHO_TOLERANCE_PX = 1
const ANCHOR_TOLERANCE_PX = 0.5

export type ViewportMode =
  | { readonly kind: 'following' }
  | { readonly kind: 'anchored'; readonly key: string; readonly top: number }
  | { readonly kind: 'new-turn'; readonly key: string; readonly top: number }

export interface ReadingPosition {
  readonly key: string
  readonly top: number
}

export class TranscriptViewportController {
  private currentMode: ViewportMode = { kind: 'following' }
  /*
   * The sent turn whose reply space is still reserved. It outlives the `new-turn` mode while the
   * reader scrolls around inside that turn, so the space tracks the turn instead of being dropped
   * under the reader: dropping it clamped the view and threw the turn down the screen.
   */
  private reservation: SentTurn | null = null
  /** Whether the reserved turn is doing work (tool calls, a Waggle turn) rather than only answering. */
  private turnHasWork = false
  /** Whether the held turn fit the viewport at the last layout, so crossing its bottom is now. */
  private heldTurnFit = true
  private expectedScrollTop: number | null = null
  private lastObservedScrollTop = 0
  /** Whether the view rested exactly at the end after the last layout or scroll. */
  private restingAtEnd = true
  /** An explicit disclosure hold, which must not turn into following at the end. */
  private holding = false
  /*
   * Whether newer rows exist beyond the mounted window. The bottom of the DOM is then not the live
   * end: resting there must not count as following, or the window would jump past unmounted
   * history instead of loading the next batch.
   */
  private windowHasLater = false

  setWindowHasLater(hasLater: boolean) {
    // When the final page mounts, resting at the old bottom is not resting at the new end: keep
    // the anchor for this commit, and follow only once the reader reaches the updated bottom.
    if (this.windowHasLater && !hasLater) this.restingAtEnd = false
    this.windowHasLater = hasLater
  }
  private endSpace = 0

  constructor(private readonly geometry: ViewportGeometry) {}

  get mode() {
    return this.currentMode
  }

  get isFollowing() {
    return this.currentMode.kind === 'following'
  }

  setTurnHasWork(hasWork: boolean) {
    this.turnHasWork = hasWork
  }

  /** The row key of the sent turn whose space is reserved, if any. */
  get sentTurnKey() {
    return this.reservation?.key ?? null
  }

  /** Whether a sent turn is held near the top, which is where the reader is looking. */
  get isHoldingSentTurn() {
    return this.currentMode.kind === 'new-turn'
  }

  /** The reading position worth saving: `null` while following the live end. */
  readingPosition(): ReadingPosition | null {
    // The bottom of a capped window is not the live end: that reader is still in history.
    const atLiveEnd = !this.windowHasLater && this.distanceToBottom() <= SCROLL_ECHO_TOLERANCE_PX
    const mode = this.currentMode
    if (mode.kind === 'following' || atLiveEnd) return null
    // A held message sits at its measured top, which a tall message moves above the preference.
    const held = mode.kind === 'new-turn' ? measureSentTurn(this.geometry, mode) : null
    return { key: mode.key, top: held?.heldTop ?? mode.top }
  }

  follow() {
    this.holding = false
    this.enterFollowing()
    this.applyLayout()
  }

  /** Holds a row where it is now. Used before a disclosure toggles. */
  hold(key: string) {
    const top = this.geometry.getRowTop(key)
    if (top === null) return
    this.holding = true
    this.currentMode = { kind: 'anchored', key, top }
  }

  restore(position: ReadingPosition) {
    this.restingAtEnd = false
    this.reservation = null
    this.currentMode = { kind: 'anchored', key: position.key, top: position.top }
    this.applyLayout()
    // A position that lands exactly at the end is a reader who left following it.
    if (!this.windowHasLater && this.distanceToBottom() <= SCROLL_ECHO_TOLERANCE_PX) this.follow()
  }

  anchorNewTurn(key: string) {
    this.holding = false
    this.heldTurnFit = true
    this.turnHasWork = false
    this.reservation = { key, top: NEW_TURN_TOP_OFFSET_PX }
    this.currentMode = { kind: 'new-turn', key, top: NEW_TURN_TOP_OFFSET_PX }
    this.applyLayout()
  }

  /**
   * Moves the reserved turn to the persisted copy of its message: the optimistic row is gone and
   * the latest user message is mounted under a new id. A steer or Follow-up that arrives while the
   * original is still mounted stays inside the held turn; re-placing on it pinned the steer while
   * the running output grew above it, out of view.
   */
  reconcileSentTurn(latestKey: string | null) {
    const reservation = this.reservation
    if (!reservation || latestKey === null || this.hasMountedRow(reservation.key)) return
    if (!this.hasMountedRow(latestKey)) return
    this.reservation = { key: latestKey, top: reservation.top }
    if (this.currentMode.kind === 'new-turn') {
      this.currentMode = { ...this.currentMode, key: latestKey }
    }
  }

  /** Ends a disclosure hold; a reader left at the live end resumes following it. */
  releaseHold() {
    this.holding = false
    if (
      this.currentMode.kind === 'anchored' &&
      !this.windowHasLater &&
      this.distanceToBottom() <= NEAR_BOTTOM_PX
    ) {
      this.rejoinEnd()
      this.applyLayout()
    }
  }

  /** A reader's explicit upward intent (wheel, touch, scrollbar drag) leaves the live end at once. */
  leaveLiveEnd() {
    // The intent wins over resting at the end until the scroll it causes arrives.
    this.restingAtEnd = false
    if (this.currentMode.kind === 'anchored') return
    this.captureReadingPosition()
  }

  /**
   * A scroll event. Echoes of the controller's own writes are ignored; anything else is the reader
   * moving, which either rejoins the live end or becomes the new reading position.
   */
  handleScroll() {
    const scrollTop = this.geometry.getScrollTop()
    const previous = this.lastObservedScrollTop
    this.lastObservedScrollTop = scrollTop
    if (
      this.expectedScrollTop !== null &&
      Math.abs(scrollTop - this.expectedScrollTop) <= SCROLL_ECHO_TOLERANCE_PX
    ) {
      return
    }
    this.expectedScrollTop = null
    this.holding = false
    /*
     * Resting exactly at the end always rejoins it (following, or the held turn whose reserved
     * space ends there): shrinking content makes the browser clamp the scroll position there,
     * which is not the reader scrolling up. Within the rest of the near-bottom band only a move
     * toward the end rejoins, or a reader nudging upward during a stream would be pulled back
     * down by the next token.
     */
    const distance = this.distanceToBottom()
    const movingUp = scrollTop < previous - SCROLL_ECHO_TOLERANCE_PX
    const atEnd = distance <= SCROLL_ECHO_TOLERANCE_PX
    this.restingAtEnd = atEnd
    if (!this.windowHasLater && (atEnd || (!movingUp && distance <= NEAR_BOTTOM_PX))) {
      this.rejoinEnd()
      return
    }
    this.captureReadingPosition()
  }

  /** Re-applies the mode after content, viewport, or row changes. Runs before paint. */
  applyLayout() {
    // A reader resting exactly at the end is following it, however they got there (a restored
    // position, an anchor that moved), so a shrinking viewport keeps the newest content in view.
    if (
      this.currentMode.kind === 'anchored' &&
      this.restingAtEnd &&
      !this.holding &&
      !this.windowHasLater
    ) {
      this.rejoinEnd()
    }
    this.applyMode()
    this.restingAtEnd = this.distanceToBottom() <= SCROLL_ECHO_TOLERANCE_PX
  }

  private applyMode() {
    const mode = this.currentMode
    if (mode.kind === 'new-turn') {
      this.applyNewTurn(mode)
      return
    }
    if (mode.kind === 'following') {
      this.setEndSpace(0)
      this.write(this.maxScrollTop())
      return
    }
    // The reserved space tracks the turn under a reader inside it, so the end never moves.
    this.setEndSpace(this.reservedSpace())
    const top = this.geometry.getRowTop(mode.key)
    if (top === null) {
      // The anchored row left the DOM (released from the window, compacted away); hold the next one.
      this.captureReadingPosition()
      return
    }
    const delta = top - mode.top
    if (Math.abs(delta) > ANCHOR_TOLERANCE_PX) this.write(this.geometry.getScrollTop() + delta)
  }

  hasMountedRow(key: string) {
    return this.geometry.getRowTop(key) !== null
  }

  distanceToBottom() {
    return this.maxScrollTop() - this.geometry.getScrollTop()
  }

  /**
   * Holds the sent message near the top while its reply streams into the space reserved below.
   * A working turn that crosses the bottom of the viewport is followed from there, moving the view
   * only by the overshoot of the commit that crossed it. A turn that crossed as a plain answer
   * stays held: following it later would throw a reader mid-answer to the end.
   */
  private applyNewTurn(mode: Extract<ViewportMode, { kind: 'new-turn' }>) {
    const layout = measureSentTurn(this.geometry, mode)
    if (!layout) {
      // The sent row left the DOM without a replacement (a refused send, compaction): its reply
      // space goes with it, and the reader's view is held by whatever row is visible.
      this.reservation = null
      this.captureReadingPosition()
      this.applyMode()
      return
    }
    const crossing = layout.overflows && this.heldTurnFit
    this.heldTurnFit = !layout.overflows
    if (crossing && this.turnHasWork) {
      this.enterFollowing()
      this.applyMode()
      return
    }
    this.setEndSpace(layout.reservedSpace)
    this.write(layout.heldScrollTop)
  }

  private reservedSpace() {
    return reservedSpaceFor(this.geometry, this.reservation)
  }

  /**
   * A reader back at the end. While a sent turn still reserves space, the end of that space is the
   * held turn itself; following would drop the space and move the turn down the screen.
   */
  private rejoinEnd() {
    const reservation = this.reservation
    if (reservation && this.reservedSpace() > 0) {
      this.currentMode = { kind: 'new-turn', key: reservation.key, top: reservation.top }
      return
    }
    this.enterFollowing()
  }

  private enterFollowing() {
    this.reservation = null
    this.currentMode = { kind: 'following' }
  }

  private captureReadingPosition() {
    const row = this.geometry.getFirstVisibleRow()
    if (row) this.currentMode = { kind: 'anchored', key: row.key, top: row.top }
    else this.enterFollowing()
  }

  private maxScrollTop() {
    return Math.max(
      0,
      this.geometry.getContentHeight() + this.endSpace - this.geometry.getClientHeight(),
    )
  }

  private setEndSpace(height: number) {
    const next = Math.max(0, Math.round(height))
    if (next === this.endSpace) return
    this.endSpace = next
    this.geometry.setEndSpace(next)
  }

  private write(scrollTop: number) {
    const target = Math.min(Math.max(0, scrollTop), this.maxScrollTop())
    if (Math.abs(this.geometry.getScrollTop() - target) <= ANCHOR_TOLERANCE_PX) return
    this.geometry.setScrollTop(target)
    this.expectedScrollTop = this.geometry.getScrollTop()
    this.lastObservedScrollTop = this.expectedScrollTop
  }
}
