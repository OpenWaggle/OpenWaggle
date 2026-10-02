import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEffect } from 'react'

const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'radio', 'reset', 'submit', 'range'])

/** Whether focus sits in another text field outside the composer, where a person is typing. */
function isTypingElsewhere(active: Element | null, root: HTMLElement) {
  if (!(active instanceof HTMLElement) || root.contains(active)) return false
  if (active instanceof HTMLTextAreaElement) return true
  if (active instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(active.type)
  return active.isContentEditable
}

/**
 * Focuses the composer when it mounts, like Lexical's `AutoFocusPlugin`, unless a person is
 * already typing in another field. Switching Sessions remounts the composer, and double-clicking a
 * Session title in the sidebar opens that Session and its inline rename field in the same gesture;
 * an unconditional focus moved the caret out of the field, which blurred and closed the rename.
 */
export function ComposerAutoFocusPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    // Placing the selection can itself focus the editable root, so check before asking Lexical.
    const root = editor.getRootElement()
    if (root !== null && isTypingElsewhere(document.activeElement, root)) return
    editor.focus(() => {
      const current = editor.getRootElement()
      if (current === null || isTypingElsewhere(document.activeElement, current)) return
      if (!current.contains(document.activeElement)) current.focus({ preventScroll: true })
    })
  }, [editor])

  return null
}
