import { setEditorText } from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'

/**
 * Keeps the plain composer store and Lexical editor in sync when workflows switch
 * draft contexts outside the editor component itself.
 */
export function setComposerTextValue(text: string) {
  const composer = useComposerStore.getState()
  composer.setInput(text)
  if (composer.lexicalEditor) {
    setEditorText(composer.lexicalEditor, text)
  }
}
