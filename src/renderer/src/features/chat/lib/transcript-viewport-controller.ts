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
  private expectedScrollTop: number | null = null
  private lastObservedScrollTop = 0
  private endSpace = 0

  constructor(private readonly geometry: ViewportGeometry) {}

  get mode() {
    return this.currentMode
  }

  get isFollowing() {
    return this.currentMode.kind === 'following'
  }

  /** The reading position worth saving: `null` while following the live end. */
  readingPosition(): ReadingPosition | null {
    if (this.currentMode.kind === 'anchored') {
      return { key: this.currentMode.key, top: this.currentMode.top }
    }
    return null
  }

  follow() {
    this.currentMode = { kind: 'following' }
    this.applyLayout()
  }

  /** Holds a row where it is now. Used before a disclosure toggles. */
  hold(key: string) {
    const top = this.geometry.getRowTop(key)
    if (top === null) return
    this.currentMode = { kind: 'anchored', key, top }
  }

  restore(position: ReadingPosition) {
    this.currentMode = { kind: 'anchored', key: position.key, top: position.top }
    this.applyLayout()
  }

  anchorNewTurn(key: string) {
    this.currentMode = { kind: 'new-turn', key, top: NEW_TURN_TOP_OFFSET_PX }
    this.applyLayout()
  }

  /** A sent turn handing over to live following: tool activity began or it outgrew the viewport. */
  releaseNewTurn() {
    if (this.currentMode.kind !== 'new-turn') return
    this.follow()
  }

  /** Ends a disclosure hold; a reader left at the live end resumes following it. */
  releaseHold() {
    if (this.currentMode.kind === 'anchored' && this.distanceToBottom() <= NEAR_BOTTOM_PX) {
      this.follow()
    }
  }

  /** A reader's explicit upward intent (wheel, touch, scrollbar drag) leaves the live end at once. */
  leaveLiveEnd() {
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
    /*
     * Resting exactly at the end always rejoins it: shrinking content makes the browser clamp the
     * scroll position there, which is not the reader scrolling up. Within the rest of the
     * near-bottom band only a move toward the end rejoins, or a reader nudging upward during a
     * stream would be pulled back down by the next token.
     */
    const distance = this.distanceToBottom()
    const movingUp = scrollTop < previous - SCROLL_ECHO_TOLERANCE_PX
    const atEnd = distance <= SCROLL_ECHO_TOLERANCE_PX
    // A sent turn sits at the end of its reserved space; a clamp there is not the reader leaving.
    if (atEnd && this.currentMode.kind === 'new-turn') return
    if (atEnd || (!movingUp && distance <= NEAR_BOTTOM_PX)) {
      this.currentMode = { kind: 'following' }
      return
    }
    this.captureReadingPosition()
  }

  /** Re-applies the mode after content, viewport, or row changes. Runs before paint. */
  applyLayout() {
    const mode = this.currentMode
    if (mode.kind === 'new-turn') {
      this.applyNewTurn(mode)
      return
    }
    this.setEndSpace(0)
    if (mode.kind === 'following') {
      this.write(this.maxScrollTop())
      return
    }
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

  private applyNewTurn(mode: Extract<ViewportMode, { kind: 'new-turn' }>) {
    const rowTop = this.geometry.getRowTop(mode.key)
    if (rowTop === null) {
      this.follow()
      return
    }
    const clientHeight = this.geometry.getClientHeight()
    const rowContentTop = this.geometry.getScrollTop() + rowTop
    const turnHeight = this.geometry.getContentHeight() - rowContentTop
    const available = clientHeight - mode.top
    if (turnHeight > available) {
      this.follow()
      return
    }
    this.setEndSpace(available - turnHeight)
    this.write(rowContentTop - mode.top)
  }

  private captureReadingPosition() {
    const row = this.geometry.getFirstVisibleRow()
    this.currentMode = row
      ? { kind: 'anchored', key: row.key, top: row.top }
      : { kind: 'following' }
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
