import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, COMMAND_PRIORITY_HIGH, PASTE_COMMAND } from 'lexical'
import { useEffect, useEffectEvent } from 'react'

interface PastePluginProps {
  checkAndConvertPaste: (pastedText: string, currentEditorText: string) => boolean
  /** Takes a paste that carries files or a clipboard image; `true` means it handled the paste. */
  onPaste?: (event: ClipboardEvent) => boolean
}

/**
 * Intercepts paste events to delegate long-text auto-attachment and clipboard images.
 * If either handles the paste, prevents Lexical from handling it.
 * Otherwise, lets Lexical handle the paste normally.
 */
export function PastePlugin({ checkAndConvertPaste, onPaste }: PastePluginProps) {
  const [editor] = useLexicalComposerContext()
  const checkPaste = useEffectEvent(checkAndConvertPaste)
  const paste = useEffectEvent((event: ClipboardEvent) => onPaste?.(event) ?? false)

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent)) return false
        const clipboardData = event.clipboardData
        if (!clipboardData) return false

        if (paste(event)) return true

        const pastedText = clipboardData.getData('text/plain')
        if (!pastedText) return false

        const currentText = editor.getEditorState().read(() => $getRoot().getTextContent())
        const converted = checkPaste(pastedText, currentText)

        // If auto-converted to attachment, prevent Lexical from inserting the text
        return converted
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor])

  return null
}
