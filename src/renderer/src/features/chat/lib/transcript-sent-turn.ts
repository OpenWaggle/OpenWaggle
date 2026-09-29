import type { ViewportGeometry } from './transcript-viewport-geometry'

/*
 * The lowest a sent message's bottom may sit, as a fraction of the viewport and in pixels, so a
 * long message still leaves its reply room below it: any message taller than that limit minus the
 * preferred top is held partly scrolled off. Codex places a sent message's bottom at
 * `max(h / 3, 240px)` for the same reason.
 */
const SENT_BOTTOM_VIEWPORT_FRACTION = 1 / 3
const SENT_BOTTOM_MIN_PX = 240

/** A row held at a preferred offset from the viewport top. */
interface HeldRow {
  readonly key: string
  readonly top: number
}

/** A sent message held near the top at a preferred offset from the viewport top. */
export interface SentTurn extends HeldRow {
  /** The row just before the message when it was sent, which pairs it with its persisted copy. */
  readonly precedingKey: string | null
}

/** What the transcript's rows say about a sent turn, read without the DOM. */
export interface TranscriptRowIndex {
  /** Every row key in order, mounted or not. */
  readonly keys: readonly string[]
  readonly isUserRow: (key: string) => boolean
  /** Whether the turn from this sent row on is doing work: tool calls or a Waggle turn. */
  readonly hasWorkAfter: (key: string) => boolean
}

/**
 * The persisted copy of a sent message whose optimistic row is gone: the user row that now sits
 * where the message was sent, right after the same preceding row. `null` when there is none (a
 * refused or queued send) or the pairing is lost. Taking the latest user row instead picked a
 * steer after the message, or the previous turn's message once the sent one was withdrawn.
 */
export function persistedSentKey(turn: SentTurn, index: TranscriptRowIndex) {
  const at = turn.precedingKey === null ? 0 : index.keys.indexOf(turn.precedingKey) + 1
  if (turn.precedingKey !== null && at === 0) return null
  const key = index.keys[at]
  return key !== undefined && index.isUserRow(key) ? key : null
}

export interface SentTurnLayout {
  /** The message's top relative to the viewport while held; above the preference when tall. */
  readonly heldTop: number
  /** The scroll position that holds the sent message in place. */
  readonly heldScrollTop: number
  /** The space still reserved below the turn; 0 once the turn fills the viewport. */
  readonly reservedSpace: number
  /** Whether the turn reaches past the bottom of the viewport while held. */
  readonly overflows: boolean
}

/** Where a held sent turn sits and how much reply space it still reserves; `null` when unmounted. */
export function measureSentTurn(geometry: ViewportGeometry, turn: HeldRow): SentTurnLayout | null {
  const rowTop = geometry.getRowTop(turn.key)
  const rowHeight = geometry.getRowHeight(turn.key)
  if (rowTop === null || rowHeight === null) return null
  const clientHeight = geometry.getClientHeight()
  const bottomLimit = Math.min(
    clientHeight,
    Math.max(clientHeight * SENT_BOTTOM_VIEWPORT_FRACTION, SENT_BOTTOM_MIN_PX),
  )
  const heldTop = Math.min(turn.top, bottomLimit - rowHeight)
  const rowContentTop = geometry.getScrollTop() + rowTop
  const turnHeight = geometry.getContentHeight() - rowContentTop
  const available = clientHeight - heldTop
  return {
    heldTop,
    heldScrollTop: rowContentTop - heldTop,
    reservedSpace: Math.max(0, available - turnHeight),
    overflows: turnHeight > available,
  }
}

/**
 * The sent turn whose reply space is reserved, and what is known about it.
 *
 * It outlives the controller's `new-turn` mode while the reader scrolls around inside the turn, so
 * the space tracks the turn instead of being dropped under the reader: dropping it clamped the
 * view and threw the turn down the screen.
 */
export class SentTurnHold {
  private turn: SentTurn | null = null
  /** Whether the turn is doing work (tool calls, a Waggle turn) rather than only answering. */
  private hasWork = false
  /** Whether the turn fit the viewport at the last held layout, so a crossing is happening now. */
  private fitAtLastLayout = true

  get current() {
    return this.turn
  }

  start(turn: SentTurn) {
    this.turn = turn
    this.hasWork = false
    this.fitAtLastLayout = true
  }

  clear() {
    this.turn = null
  }

  /** Held again from the end of its space: a turn that still reserves space fits the viewport. */
  resume() {
    this.fitAtLastLayout = true
  }

  /**
   * Reads the rows after a commit: a message whose optimistic row was replaced moves to its
   * persisted copy, and work is judged over the whole turn, so a steer does not hide the work
   * before it. Returns the new key when the message moved.
   */
  sync(index: TranscriptRowIndex, isMounted: (key: string) => boolean) {
    const turn = this.turn
    if (!turn) return null
    const copy = isMounted(turn.key) ? null : persistedSentKey(turn, index)
    const moved = copy !== null && isMounted(copy) ? copy : null
    if (moved !== null) this.turn = { ...turn, key: moved }
    this.hasWork = index.hasWorkAfter(moved ?? turn.key)
    return moved
  }

  /**
   * Records a held layout and says whether to hand over to following: only a working turn, and
   * only on the layout where it crosses the bottom. One that crossed as a plain answer stays
   * held, because following it later would throw a reader mid-answer to the end.
   */
  crossesWhileWorking(layout: SentTurnLayout) {
    const crossing = layout.overflows && this.fitAtLastLayout
    this.fitAtLastLayout = !layout.overflows
    return crossing && this.hasWork
  }

  /** The space that keeps the turn in place, or 0 once it fills the viewport. */
  reservedSpace(geometry: ViewportGeometry) {
    return (this.turn ? measureSentTurn(geometry, this.turn) : null)?.reservedSpace ?? 0
  }
}
