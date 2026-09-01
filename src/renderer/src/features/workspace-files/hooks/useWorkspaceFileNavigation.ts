import { useEffect, useEffectEvent, useState } from 'react'

const DECIMAL_RADIX = 10

interface WorkspaceNavigationInput {
  readonly projectPath: string | null
  readonly relativePath: string
  readonly line: number | null
  readonly onClose: () => void
  readonly onOpenFile: (path: string, line?: number | null) => void
}

function useWorkspaceNavigationState(input: WorkspaceNavigationInput) {
  const [goToLineOpen, setGoToLineOpen] = useState(false)
  const [goToLineValue, setGoToLineValue] = useState(input.line ? String(input.line) : '')

  return {
    goToLineOpen,
    setGoToLineOpen,
    goToLineValue,
    setGoToLineValue,
  }
}

function useWorkspaceKeyboardShortcuts(
  input: WorkspaceNavigationInput,
  state: ReturnType<typeof useWorkspaceNavigationState>,
) {
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) return
    if (event.key.toLowerCase() === 'w') {
      event.preventDefault()
      input.onClose()
    }
    if (event.key.toLowerCase() === 'g') {
      event.preventDefault()
      state.setGoToLineValue(input.line ? String(input.line) : '')
      state.setGoToLineOpen(true)
    }
  })
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}

export function useWorkspaceFileNavigation(input: WorkspaceNavigationInput) {
  const state = useWorkspaceNavigationState(input)

  function goToLine() {
    const lineNumber = Number.parseInt(state.goToLineValue, DECIMAL_RADIX)
    if (!Number.isSafeInteger(lineNumber) || lineNumber < 1) return
    state.setGoToLineOpen(false)
    input.onOpenFile(input.relativePath, lineNumber)
  }

  useWorkspaceKeyboardShortcuts(input, state)
  return { ...state, goToLine }
}
