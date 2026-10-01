/** Where a moved message goes: just before or just after another visible message. */
export interface QueuedMessageAnchor {
  readonly position: 'before' | 'after'
  readonly followUpId: string
}

export interface QueuedMessageMove {
  /** The whole queue's order, for `queue-reorder`. */
  readonly order: string[]
  /** One-based position of the moved message among the visible messages, and how many there are. */
  readonly position: number
  readonly count: number
}

/**
 * The whole queue's order after placing one visible message next to `anchor`, or null when the
 * move does nothing or cannot be made (either message is gone or locked).
 *
 * Anchored to a neighbour's id rather than an index, so replaying the move against a queue that
 * changed in between still means what the user did. Locked messages (reserved by a pending
 * steering promotion, so hidden from the dock) keep their exact slots: the Host needs every
 * queued id, and a move in the dock must not shift a message the user cannot see.
 */
export function moveQueuedMessage(
  queueIds: readonly string[],
  lockedIds: ReadonlySet<string>,
  followUpId: string,
  anchor: QueuedMessageAnchor,
): QueuedMessageMove | null {
  const visible = queueIds.filter((id) => !lockedIds.has(id))
  if (!visible.includes(followUpId) || anchor.followUpId === followUpId) return null
  const moved = visible.filter((id) => id !== followUpId)
  const anchorIndex = moved.indexOf(anchor.followUpId)
  if (anchorIndex < 0) return null
  moved.splice(anchorIndex + (anchor.position === 'after' ? 1 : 0), 0, followUpId)
  if (moved.every((id, index) => id === visible[index])) return null
  let next = 0
  const order = queueIds.map((id) => {
    if (lockedIds.has(id)) return id
    const placed = moved[next] ?? id
    next += 1
    return placed
  })
  return { order, position: moved.indexOf(followUpId) + 1, count: moved.length }
}

/** Dropping onto a row: a message dragged down lands after it, one dragged up lands before it. */
export function dropAnchor(
  visibleIds: readonly string[],
  draggedId: string,
  targetId: string,
): QueuedMessageAnchor | null {
  const from = visibleIds.indexOf(draggedId)
  const to = visibleIds.indexOf(targetId)
  if (from < 0 || to < 0 || from === to) return null
  return { position: from < to ? 'after' : 'before', followUpId: targetId }
}
