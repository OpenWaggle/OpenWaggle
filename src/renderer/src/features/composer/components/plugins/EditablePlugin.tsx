import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEffect } from 'react'

interface EditablePluginProps {
  readonly disabled?: boolean
}

export function EditablePlugin({ disabled }: EditablePluginProps): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editor.setEditable(!disabled)
  }, [disabled, editor])

  return null
}
