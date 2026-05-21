import type { LexicalEditor } from 'lexical'
import type { RefObject } from 'react'
import { LexicalComposerEditor } from './LexicalComposerEditor'

interface ComposerEditorAreaProps {
  readonly onSubmit: (text?: string) => void
  readonly disabled?: boolean
  readonly placeholder?: string
  readonly isLoading: boolean
  readonly editorRef: RefObject<LexicalEditor | null>
  readonly checkAndConvertPaste: (pastedText: string, currentEditorText: string) => boolean
}

export function ComposerEditorArea({
  onSubmit,
  disabled,
  placeholder,
  isLoading,
  editorRef,
  checkAndConvertPaste,
}: ComposerEditorAreaProps) {
  return (
    <div className="relative min-h-[60px] px-4 py-[14px]">
      <LexicalComposerEditor
        onSubmit={onSubmit}
        disabled={disabled}
        placeholder={placeholder ?? getDefaultPlaceholder(isLoading)}
        editorRef={editorRef}
        checkAndConvertPaste={checkAndConvertPaste}
      />
    </div>
  )
}

function getDefaultPlaceholder(isLoading: boolean) {
  return isLoading ? 'Add a message to the session...' : 'Ask for follow-up changes'
}
