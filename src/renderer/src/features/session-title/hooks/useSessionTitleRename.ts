import type { SessionId } from '@shared/types/brand'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { renameSession } from '../lib/session-title-commands'

export interface SessionTitleRenameController {
  readonly isEditing: boolean
  readonly draft: string
  readonly inputRef: RefObject<HTMLInputElement | null>
  /** The control that started the edit; keyboard endings return focus to it. */
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>
  readonly start: () => void
  readonly setDraft: (value: string) => void
  /** Enter: save the trimmed draft and return focus to the title. */
  readonly submit: () => void
  /** Leaving the field saves, unless nobody moved focus away (see `useSessionTitleRename`). */
  readonly blur: () => void
  /** Escape: discard the draft and return focus to the title. */
  readonly cancel: () => void
}

interface RenameEdit {
  readonly draft: string
  /** The title the edit started from, so a title that changes meanwhile is not saved over. */
  readonly baseline: string
}

const USER_INPUT_EVENTS = ['pointerdown', 'keydown'] as const
/**
 * How long after an edit starts a focus move nobody asked for is undone instead of saving. React
 * restores focus when the Session switch commits, which a large Session can delay well past a
 * frame; the window stays at a second so an assistive technology moving focus without key events
 * is held back only briefly.
 */
const PROGRAMMATIC_BLUR_GRACE_MS = 1_000

/**
 * Inline rename for one Session title. Enter or blur saves, Escape cancels.
 *
 * Ending an edit unmounts the field, which can blur it after the edit already ended; the ref
 * keeps that late blur from saving a cancelled draft or saving a second time.
 *
 * A save compares the draft with the title the edit started from. A generated or regenerated
 * title can land while the field is open; leaving the field untouched must keep that title, not
 * pin the stale one as a manual rename that generation would never replace.
 *
 * Only a person ends an edit by leaving the field. Double-clicking an inactive Session row opens
 * that Session with the first click and the rename with the second, and React then restores the
 * focus it captured before the Session switch committed, which moved the caret to the composer
 * and closed the rename. A blur just after the edit starts, with no pointer or key input since,
 * puts the caret back instead.
 */
export function useSessionTitleRename(
  sessionId: SessionId | null,
  title: string,
): SessionTitleRenameController {
  const [edit, setEdit] = useState<RenameEdit | null>(null)
  const editingRef = useRef(false)
  const startedAtRef = useRef(0)
  const userActedRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLButtonElement>(null)
  const isEditing = edit !== null

  useEffect(() => {
    if (!isEditing) return
    const markUserAction = () => {
      userActedRef.current = true
    }
    for (const type of USER_INPUT_EVENTS) document.addEventListener(type, markUserAction, true)
    return () => {
      for (const type of USER_INPUT_EVENTS) document.removeEventListener(type, markUserAction, true)
    }
  }, [isEditing])

  useEffect(() => {
    if (!isEditing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  function end() {
    editingRef.current = false
    setEdit(null)
  }

  function returnFocus() {
    requestAnimationFrame(() => returnFocusRef.current?.focus())
  }

  function save() {
    if (!editingRef.current || sessionId === null || edit === null) return
    end()
    void renameSession(sessionId, { baseline: edit.baseline, current: title }, edit.draft)
  }

  function blur() {
    if (!editingRef.current) return
    const unrequested =
      !userActedRef.current && performance.now() - startedAtRef.current < PROGRAMMATIC_BLUR_GRACE_MS
    if (!unrequested) {
      save()
      return
    }
    requestAnimationFrame(() => {
      if (editingRef.current) inputRef.current?.focus()
    })
  }

  return {
    isEditing,
    draft: edit?.draft ?? '',
    inputRef,
    returnFocusRef,
    start() {
      if (sessionId === null) return
      editingRef.current = true
      startedAtRef.current = performance.now()
      userActedRef.current = false
      setEdit({ draft: title, baseline: title })
    },
    setDraft: (draft) => setEdit((current) => (current ? { ...current, draft } : current)),
    submit() {
      if (!editingRef.current) return
      save()
      returnFocus()
    },
    blur,
    cancel() {
      if (!editingRef.current) return
      end()
      returnFocus()
    },
  }
}
