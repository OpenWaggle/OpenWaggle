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
 * A sent turn stays held until the reader moves (ChatGPT and Codex behave the same way): its
 * reply fills the space reserved under it, then grows below the fold without moving the view.
 * Scrolling down to the live end is what hands the turn over to following.
 *
 * DOM access goes through `ViewportGeometry` so the rules are testable without layout.
 */

export const NEAR_BOTTOM_PX = 64
/** Where a sent message settles, below the transcript's top fade. */
export const NEW_TURN_TOP_OFFSET_PX = 24
const SCROLL_ECHO_TOLERANCE_PX = 1
const ANCHOR_TOLERANCE_PX = 0.5

export interface ViewportGeometry {
  getScrollTop(): number
  setScrollTop(value: number): void
  getClientHeight(): number
  /** Scrollable height excluding the reserved end space. */
  getContentHeight(): number
  /** Reserves space after the last row so a sent message can sit near the top. */
  setEndSpace(height: number): void
  /** Top of the row with this key relative to the viewport top, or `null` when not mounted. */
  getRowTop(key: string): number | null
  /** The first row whose bottom is below the viewport top. */
  getFirstVisibleRow(): { readonly key: string; readonly top: number } | null
}

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
   * reader scrolls around inside that turn, so the space is only ever consumed by the reply, never
   * dropped under the reader: dropping it clamped the view and threw the turn down the screen.
   */
  private reservation: { readonly key: string; readonly top: number } | null = null
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

  /** Whether a sent turn is held near the top, which is where the reader is looking. */
  get isHoldingSentTurn() {
    return this.currentMode.kind === 'new-turn'
  }

  /** The reading position worth saving: `null` while following the live end. */
  readingPosition(): ReadingPosition | null {
    // The bottom of a capped window is not the live end: that reader is still in history.
    const atLiveEnd = !this.windowHasLater && this.distanceToBottom() <= SCROLL_ECHO_TOLERANCE_PX
    if (this.currentMode.kind !== 'following' && !atLiveEnd) {
      return { key: this.currentMode.key, top: this.currentMode.top }
    }
    return null
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
    this.reservation = { key, top: NEW_TURN_TOP_OFFSET_PX }
    this.currentMode = { kind: 'new-turn', key, top: NEW_TURN_TOP_OFFSET_PX }
    this.applyLayout()
  }

  /** The row key of the sent turn whose reply space is reserved, if any. */
  get sentTurnKey() {
    return this.reservation?.key ?? null
  }

  /** The sent message now lives under another row key: its optimistic copy was persisted. */
  replaceSentTurn(key: string) {
    if (!this.reservation) return
    this.reservation = { key, top: this.reservation.top }
    if (this.currentMode.kind === 'new-turn') this.currentMode = { ...this.currentMode, key }
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
     * Resting exactly at the end always rejoins it: shrinking content makes the browser clamp the
     * scroll position there, which is not the reader scrolling up. Within the rest of the
     * near-bottom band only a move toward the end rejoins, or a reader nudging upward during a
     * stream would be pulled back down by the next token.
     */
    const distance = this.distanceToBottom()
    const movingUp = scrollTop < previous - SCROLL_ECHO_TOLERANCE_PX
    const atEnd = distance <= SCROLL_ECHO_TOLERANCE_PX
    this.restingAtEnd = atEnd
    // A held sent turn that is still where the controller put it was clamped, not scrolled.
    if (this.currentMode.kind === 'new-turn' && this.isAtNewTurnPosition(this.currentMode)) return
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
    // The reply consumes the reserved space as it grows; the space is never dropped under a reader.
    this.setEndSpace(Math.min(this.endSpace, this.reservedSpace()))
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
   * Holds the sent message near the top. The reply streams into the space reserved below it; once
   * it outgrows the viewport it continues below the fold and the view stays where it is.
   */
  private applyNewTurn(mode: Extract<ViewportMode, { kind: 'new-turn' }>) {
    const rowTop = this.geometry.getRowTop(mode.key)
    if (rowTop === null) {
      // The sent row left the DOM without a replacement: hold what the reader sees instead.
      this.reservation = null
      this.captureReadingPosition()
      this.applyMode()
      return
    }
    const rowContentTop = this.geometry.getScrollTop() + rowTop
    this.setEndSpace(this.reservedSpace())
    this.write(rowContentTop - mode.top)
  }

  /** The space that keeps the reserved sent turn near the top, or 0 once its reply fills the view. */
  private reservedSpace() {
    const reservation = this.reservation
    const rowTop = reservation ? this.geometry.getRowTop(reservation.key) : null
    if (!reservation || rowTop === null) return 0
    const rowContentTop = this.geometry.getScrollTop() + rowTop
    const turnHeight = this.geometry.getContentHeight() - rowContentTop
    return Math.max(0, this.geometry.getClientHeight() - reservation.top - turnHeight)
  }

  /** Whether the held sent turn sits where the controller put it, allowing for a browser clamp. */
  private isAtNewTurnPosition(mode: Extract<ViewportMode, { kind: 'new-turn' }>) {
    const rowTop = this.geometry.getRowTop(mode.key)
    if (rowTop === null) return false
    const scrollTop = this.geometry.getScrollTop()
    const target = Math.min(Math.max(0, scrollTop + rowTop - mode.top), this.maxScrollTop())
    return Math.abs(scrollTop - target) <= SCROLL_ECHO_TOLERANCE_PX
  }

  /**
   * A reader back at the end. While a sent turn still has reserved space, the end of that space is
   * the held turn itself; following would drop the space and move the turn down the screen.
   */
  private rejoinEnd() {
    const reservation = this.reservation
    if (reservation && this.endSpace > 0 && this.geometry.getRowTop(reservation.key) !== null) {
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
