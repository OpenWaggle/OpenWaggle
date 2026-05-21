import type { SessionNode } from '@shared/types/session'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey'
import {
  findFirstVisibleChildIndex,
  findVisibleParentIndex,
  moveSessionTreeFocus,
} from '../lib/session-tree-visibility'
import type { SessionTreeRow } from '../model'

interface SessionTreeKeyboardControlsInput {
  readonly clampedFocusIndex: number
  readonly focusIndex: number
  readonly rowExpandedNodeIds: readonly SessionNode['id'][]
  readonly visibleRows: readonly SessionTreeRow[]
  readonly onClose: () => void
  readonly onFocusIndex: (index: number) => void
  readonly onSelectNode: (node: SessionNode) => void
  readonly onToggleNodeExpanded: (row: SessionTreeRow) => void
}

function isExpandedNode(node: SessionNode, expandedNodeIds: readonly SessionNode['id'][]) {
  return expandedNodeIds.some((expandedNodeId) => String(expandedNodeId) === String(node.id))
}

export function useSessionTreeKeyboardControls(input: SessionTreeKeyboardControlsInput) {
  const enabled = input.visibleRows.length > 0

  function moveFocus(direction: 'next' | 'previous') {
    input.onFocusIndex(
      moveSessionTreeFocus({
        currentIndex: input.focusIndex,
        visibleCount: input.visibleRows.length,
        direction,
      }),
    )
  }

  function selectFocusedNode() {
    const focusedRow = input.visibleRows[input.clampedFocusIndex]
    if (focusedRow) {
      input.onSelectNode(focusedRow.node)
    }
  }

  function expandFocusedNode() {
    const focusedRow = input.visibleRows[input.clampedFocusIndex]
    if (!focusedRow) {
      return
    }
    if (isExpandedNode(focusedRow.node, input.rowExpandedNodeIds)) {
      input.onFocusIndex(findFirstVisibleChildIndex(input.visibleRows, input.clampedFocusIndex))
      return
    }
    if (focusedRow.hasExpandableChildren) {
      input.onToggleNodeExpanded(focusedRow)
    }
  }

  function collapseFocusedNode() {
    const focusedRow = input.visibleRows[input.clampedFocusIndex]
    if (!focusedRow) {
      return
    }
    if (isExpandedNode(focusedRow.node, input.rowExpandedNodeIds)) {
      input.onToggleNodeExpanded(focusedRow)
      return
    }
    input.onFocusIndex(findVisibleParentIndex(input.visibleRows, input.clampedFocusIndex))
  }

  useEscapeHotkey(input.onClose)
  useHotkey('ArrowDown', () => moveFocus('next'), { enabled, preventDefault: true })
  useHotkey('ArrowUp', () => moveFocus('previous'), { enabled, preventDefault: true })
  useHotkey('Enter', selectFocusedNode, {
    enabled,
    preventDefault: true,
    conflictBehavior: 'allow',
  })
  useHotkey('ArrowRight', expandFocusedNode, { enabled, preventDefault: true })
  useHotkey('ArrowLeft', collapseFocusedNode, { enabled, preventDefault: true })
}
