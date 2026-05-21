import { compactCommandText } from '@/features/composer/commands'
import { setEditorText } from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { useUIStore } from '@/shell/ui-store'

export function createOptionalCommandPaletteAction(
  closeCommandPalette: () => void,
  action?: () => void,
) {
  if (!action) return undefined
  return () => {
    closeCommandPalette()
    action()
  }
}

export function insertCompactCommand() {
  const commandText = `${compactCommandText()} `
  const composerStore = useComposerStore.getState()
  const editor = composerStore.lexicalEditor

  if (!editor) {
    composerStore.setInput(commandText)
    composerStore.setCursorIndex(commandText.length)
    return
  }

  setEditorText(editor, commandText)
  editor.focus()
}

export function openFeedbackModal() {
  const store = useUIStore.getState()
  store.closeCommandPalette()
  store.openFeedbackModal()
}
