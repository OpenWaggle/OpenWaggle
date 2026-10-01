import type { SessionId } from '@shared/types/brand'
import { useEffect, useRef, useState } from 'react'
import { renameSession } from '../lib/session-title-commands'

export interface SessionTitleRenameController {
  readonly isEditing: boolean
  readonly draft: string
  readonly inputRef: React.RefObject<HTMLInputElement | null>
  readonly start: () => void
  readonly setDraft: (value: string) => void
  /** Save the trimmed draft; blank or unchanged drafts end the edit without IPC. */
  readonly save: () => void
  readonly cancel: () => void
}

/**
 * Inline rename for one Session title. Enter or blur saves, Escape cancels.
 *
 * Ending an edit unmounts the field, which can blur it after the edit already ended; the ref
 * keeps that late blur from saving a cancelled draft or saving a second time.
 */
export function useSessionTitleRename(
  sessionId: SessionId | null,
  title: string,
): SessionTitleRenameController {
  const [draft, setDraftState] = useState<string | null>(null)
  const editingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const isEditing = draft !== null

  useEffect(() => {
    if (!isEditing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  function end() {
    editingRef.current = false
    setDraftState(null)
  }

  return {
    isEditing,
    draft: draft ?? '',
    inputRef,
    start() {
      if (sessionId === null) return
      editingRef.current = true
      setDraftState(title)
    },
    setDraft: setDraftState,
    save() {
      if (!editingRef.current || sessionId === null) return
      const submitted = draft ?? ''
      end()
      void renameSession(sessionId, title, submitted)
    },
    cancel() {
      if (!editingRef.current) return
      end()
    },
  }
}
