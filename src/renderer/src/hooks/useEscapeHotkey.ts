import { useHotkey } from '@tanstack/react-hotkeys'
import { useEffect, useId } from 'react'

const escapeStack: string[] = []
const escapeEnabledById = new Map<string, boolean>()

function moveEscapeIdToTop(id: string): void {
  const index = escapeStack.indexOf(id)
  if (index >= 0) {
    escapeStack.splice(index, 1)
  }
  escapeStack.push(id)
}

function topmostEnabledEscapeId(): string | null {
  for (let index = escapeStack.length - 1; index >= 0; index -= 1) {
    const id = escapeStack[index]
    if (id && escapeEnabledById.get(id) === true) {
      return id
    }
  }
  return null
}

interface EscapeHotkeyOptions {
  readonly enabled?: boolean
}

export function useEscapeHotkey(onEscape: () => void, options: EscapeHotkeyOptions = {}): void {
  const id = useId()
  const enabled = options.enabled ?? true

  useEffect(() => {
    escapeStack.push(id)
    return () => {
      const index = escapeStack.indexOf(id)
      if (index >= 0) {
        escapeStack.splice(index, 1)
      }
      escapeEnabledById.delete(id)
    }
  }, [id])

  useEffect(() => {
    escapeEnabledById.set(id, enabled)
    if (enabled) {
      moveEscapeIdToTop(id)
    }
  }, [enabled, id])

  useHotkey(
    'Escape',
    (event) => {
      if (!enabled || topmostEnabledEscapeId() !== id) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      onEscape()
    },
    {
      enabled,
      preventDefault: false,
      stopPropagation: false,
      ignoreInputs: false,
      conflictBehavior: 'allow',
    },
  )
}
