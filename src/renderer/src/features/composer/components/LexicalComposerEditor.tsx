import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import type { LexicalEditor } from 'lexical'
import type { RefObject } from 'react'
import { cn } from '@/shared/lib/cn'
import { createRendererLogger } from '@/shared/lib/logger'
import { FileMentionNode } from './nodes/FileMentionNode'
import { SkillMentionNode } from './nodes/SkillMentionNode'
import { SymbolMentionNode } from './nodes/SymbolMentionNode'
import { WaggleMentionNode } from './nodes/WaggleMentionNode'
import { AutoResizePlugin } from './plugins/AutoResizePlugin'
import { EditablePlugin } from './plugins/EditablePlugin'
import { EditorRefPlugin } from './plugins/EditorRefPlugin'
import { KeyboardPlugin } from './plugins/KeyboardPlugin'
import { MentionTypeaheadPlugin } from './plugins/MentionTypeaheadPlugin'
import { PastePlugin } from './plugins/PastePlugin'
import { SlashCommandPlugin } from './plugins/SlashCommandPlugin'
import { SyncPlugin } from './plugins/SyncPlugin'

interface LexicalComposerEditorProps {
  onSubmit: (text: string) => void
  disabled?: boolean
  placeholder: string
  editorRef: RefObject<LexicalEditor | null>
  checkAndConvertPaste: (pastedText: string, currentEditorText: string) => boolean
}

const logger = createRendererLogger('lexical-composer')

const EDITOR_THEME = {
  root: 'composer-lexical-root',
  paragraph: 'composer-lexical-paragraph m-0',
}

const EDITOR_CONFIG = {
  namespace: 'composer',
  theme: EDITOR_THEME,
  nodes: [FileMentionNode, SkillMentionNode, SymbolMentionNode, WaggleMentionNode],
  onError: (error: Error) => {
    logger.error('Lexical editor error', { message: error.message })
  },
}

export function LexicalComposerEditor({
  onSubmit,
  disabled,
  placeholder,
  editorRef,
  checkAndConvertPaste,
}: LexicalComposerEditorProps) {
  return (
    <LexicalComposer initialConfig={EDITOR_CONFIG}>
      <PlainTextPlugin
        contentEditable={
          <ContentEditable
            aria-label="Message input"
            aria-disabled={disabled}
            className={cn(
              'w-full min-h-6 resize-none bg-transparent text-sm text-text-primary',
              'focus:outline-none focus-visible:shadow-none',
              'disabled:opacity-50',
            )}
          />
        }
        placeholder={
          <div className="pointer-events-none absolute top-4 left-4 text-sm text-text-tertiary select-none">
            {placeholder}
          </div>
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <AutoFocusPlugin />
      <EditablePlugin disabled={disabled} />
      <KeyboardPlugin onSubmit={onSubmit} />
      <SyncPlugin />
      <SlashCommandPlugin />
      <AutoResizePlugin />
      <PastePlugin checkAndConvertPaste={checkAndConvertPaste} />
      <MentionTypeaheadPlugin />
      <EditorRefPlugin editorRef={editorRef} />
    </LexicalComposer>
  )
}
