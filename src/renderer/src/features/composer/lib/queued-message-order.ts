/**
 * The whole queue's order after moving one visible message to `targetIndex` among the visible
 * messages, or null when the move does nothing or cannot be made.
 *
 * Locked messages (reserved by a pending steering promotion, so hidden from the dock) keep their
 * exact slots: the Host needs every queued id, and a move in the dock must not shift a message the
 * user cannot see.
 */
export function reorderedFollowUpIds(
  queueIds: readonly string[],
  lockedIds: ReadonlySet<string>,
  followUpId: string,
  targetIndex: number,
): string[] | null {
  const visible = queueIds.filter((id) => !lockedIds.has(id))
  const from = visible.indexOf(followUpId)
  if (from < 0 || targetIndex < 0 || targetIndex >= visible.length || from === targetIndex) {
    return null
  }
  const moved = visible.filter((id) => id !== followUpId)
  moved.splice(targetIndex, 0, followUpId)
  let next = 0
  return queueIds.map((id) => {
    if (lockedIds.has(id)) return id
    const placed = moved[next] ?? id
    next += 1
    return placed
  })
}
