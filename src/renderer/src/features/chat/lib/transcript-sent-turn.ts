import type { ViewportGeometry } from './transcript-viewport-geometry'

/*
 * The lowest a sent message's bottom may sit, as a fraction of the viewport and in pixels, so a
 * long message still leaves its reply room below it: any message taller than that limit minus the
 * preferred top is held partly scrolled off. Codex places a sent
 * message's bottom at `max(h / 3, 240px)` for the same reason.
 */
const SENT_BOTTOM_VIEWPORT_FRACTION = 1 / 3
const SENT_BOTTOM_MIN_PX = 240

/** A sent message held near the top at a preferred offset from the viewport top. */
export interface SentTurn {
  readonly key: string
  readonly top: number
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
export function measureSentTurn(geometry: ViewportGeometry, turn: SentTurn): SentTurnLayout | null {
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

/** The space that keeps a reserved sent turn in place, or 0 once it fills the viewport. */
export function reservedSpaceFor(geometry: ViewportGeometry, turn: SentTurn | null) {
  return (turn ? measureSentTurn(geometry, turn) : null)?.reservedSpace ?? 0
}
