import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import type { LexicalEditor } from 'lexical'
import type { MutableRefObject } from 'react'
import { cn } from '@/lib/cn'
import { createRendererLogger } from '@/lib/logger'
import { FileMentionNode } from './nodes/FileMentionNode'
import { SkillMentionNode } from './nodes/SkillMentionNode'
import { SymbolMentionNode } from './nodes/SymbolMentionNode'
import { AutoResizePlugin } from './plugins/AutoResizePlugin'
import { EditorRefPlugin } from './plugins/EditorRefPlugin'
import { KeyboardPlugin } from './plugins/KeyboardPlugin'
import { MentionTypeaheadPlugin } from './plugins/MentionTypeaheadPlugin'
import { PastePlugin } from './plugins/PastePlugin'
import { SyncPlugin } from './plugins/SyncPlugin'

interface LexicalComposerEditorProps {
  onSubmit: (text: string) => void
  disabled?: boolean
  placeholder: string
  editorRef: MutableRefObject<LexicalEditor | null>
  checkAndConvertPaste: (pastedText: string, currentEditorText: string) => boolean
}

const logger = createRendererLogger('lexical-composer')

const EDITOR_THEME = {
  root: 'composer-lexical-root',
  paragraph: 'composer-lexical-paragraph m-0',
}

export function LexicalComposerEditor({
  onSubmit,
  disabled,
  placeholder,
  editorRef,
  checkAndConvertPaste,
}: LexicalComposerEditorProps) {
  const initialConfig = {
    namespace: 'composer',
    theme: EDITOR_THEME,
    nodes: [FileMentionNode, SkillMentionNode, SymbolMentionNode],
    editable: !disabled,
    onError: (error: Error) => {
      logger.error('Lexical editor error', { message: error.message })
    },
  }

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <PlainTextPlugin
        contentEditable={
          <ContentEditable
            aria-label="Message input"
            className={cn(
              'w-full min-h-[24px] resize-none bg-transparent text-[15px] text-text-primary',
              'focus:outline-none focus-visible:shadow-none',
              'disabled:opacity-50',
            )}
          />
        }
        placeholder={
          <div className="pointer-events-none absolute top-[14px] left-4 text-[15px] text-text-tertiary select-none">
            {placeholder}
          </div>
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <AutoFocusPlugin />
      <KeyboardPlugin onSubmit={onSubmit} />
      <SyncPlugin />
      <AutoResizePlugin />
      <PastePlugin checkAndConvertPaste={checkAndConvertPaste} />
      <MentionTypeaheadPlugin />
      <EditorRefPlugin editorRef={editorRef} />
    </LexicalComposer>
  )
}
