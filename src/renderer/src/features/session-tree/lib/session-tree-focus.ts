import { SESSION_TREE } from '../constants'
import type { MoveSessionTreeFocusInput, SessionTreeRow } from '../model'

export function findFirstVisibleChildIndex(
  visibleRows: readonly SessionTreeRow[],
  currentIndex: number,
): number {
  const currentRow = visibleRows[currentIndex]
  if (!currentRow) {
    return currentIndex
  }
  const childIndex = visibleRows.findIndex((row) => row.visibleParentId === currentRow.node.id)
  return childIndex >= SESSION_TREE.TRAVERSAL.FIRST_INDEX ? childIndex : currentIndex
}

export function findVisibleParentIndex(
  visibleRows: readonly SessionTreeRow[],
  currentIndex: number,
): number {
  const currentRow = visibleRows[currentIndex]
  if (!currentRow?.visibleParentId) {
    return currentIndex
  }
  const parentIndex = visibleRows.findIndex((row) => row.node.id === currentRow.visibleParentId)
  return parentIndex >= SESSION_TREE.TRAVERSAL.FIRST_INDEX ? parentIndex : currentIndex
}

export function clampSessionTreeFocusIndex(currentIndex: number, visibleCount: number): number {
  if (visibleCount <= SESSION_TREE.TRAVERSAL.FIRST_INDEX) {
    return SESSION_TREE.TRAVERSAL.FIRST_INDEX
  }
  if (currentIndex < SESSION_TREE.TRAVERSAL.FIRST_INDEX) {
    return SESSION_TREE.TRAVERSAL.FIRST_INDEX
  }
  if (currentIndex >= visibleCount) {
    return visibleCount - SESSION_TREE.TRAVERSAL.NEXT_ITEM_DELTA
  }
  return currentIndex
}

export function moveSessionTreeFocus({
  currentIndex,
  visibleCount,
  direction,
}: MoveSessionTreeFocusInput): number {
  if (visibleCount <= SESSION_TREE.TRAVERSAL.FIRST_INDEX) {
    return SESSION_TREE.TRAVERSAL.FIRST_INDEX
  }

  const delta =
    direction === 'next'
      ? SESSION_TREE.TRAVERSAL.NEXT_ITEM_DELTA
      : SESSION_TREE.TRAVERSAL.PREVIOUS_ITEM_DELTA
  return clampSessionTreeFocusIndex(currentIndex + delta, visibleCount)
}
