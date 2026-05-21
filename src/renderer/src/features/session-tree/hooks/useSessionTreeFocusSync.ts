import type { SessionNode } from '@shared/types/session'
import { useEffect, useRef } from 'react'

interface SessionTreeFocusSyncInput {
  readonly clampedFocusIndex: number
  readonly rowRefs: React.RefObject<Map<string, HTMLButtonElement>>
  readonly treeRowsRef: React.RefObject<HTMLDivElement | null>
  readonly visibleNodes: readonly SessionNode[]
}

export function useSessionTreeFocusSync(input: SessionTreeFocusSyncInput) {
  const hasFocusedTreeRowRef = useRef(false)

  useEffect(() => {
    const node = input.visibleNodes[input.clampedFocusIndex]
    if (!node) {
      return
    }

    const activeElement = document.activeElement
    const focusIsInTreeRows = activeElement
      ? input.treeRowsRef.current?.contains(activeElement)
      : false
    if (hasFocusedTreeRowRef.current && !focusIsInTreeRows) {
      return
    }

    hasFocusedTreeRowRef.current = true
    input.rowRefs.current.get(String(node.id))?.focus()
  }, [input.visibleNodes, input.clampedFocusIndex, input.rowRefs, input.treeRowsRef])
}
