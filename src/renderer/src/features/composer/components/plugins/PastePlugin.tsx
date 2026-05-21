import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, COMMAND_PRIORITY_HIGH, PASTE_COMMAND } from 'lexical'
import { useEffect } from 'react'

interface PastePluginProps {
  checkAndConvertPaste: (pastedText: string, currentEditorText: string) => boolean
}

/**
 * Intercepts paste events to delegate long-text auto-attachment.
 * If the paste triggers auto-conversion, prevents Lexical from handling it.
 * Otherwise, lets Lexical handle the paste normally.
 */
export function PastePlugin({ checkAndConvertPaste }: PastePluginProps): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand<ClipboardEvent>(
      PASTE_COMMAND,
      (event) => {
        const clipboardData = event instanceof ClipboardEvent ? event.clipboardData : null
        if (!clipboardData) return false

        const pastedText = clipboardData.getData('text/plain')
        if (!pastedText) return false

        const currentText = editor.getEditorState().read(() => $getRoot().getTextContent())
        const converted = checkAndConvertPaste(pastedText, currentText)

        // If auto-converted to attachment, prevent Lexical from inserting the text
        return converted
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, checkAndConvertPaste])

  return null
}
