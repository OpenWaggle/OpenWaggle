import type { WorkspaceTextFileReadResult } from '@shared/types/workspace-files'
import { Code2, Eye, RotateCcw, Save, WrapText } from 'lucide-react'
import type { ChangeEventHandler, KeyboardEventHandler, RefObject, UIEventHandler } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { Button } from '@/shared/ui/Button'
import { type SaveStatus, useWorkspaceFileEditing } from '../hooks/useWorkspaceFileEditing'

function LineGutter({ content }: { readonly content: string }) {
  const count = content.split('\n').length
  return (
    <pre
      aria-hidden="true"
      className="select-none border-r border-border bg-bg-secondary px-2 py-3 text-right font-mono text-[11px] leading-5 text-text-muted"
    >
      {Array.from({ length: count }, (_, index) => index + 1).join('\n')}
    </pre>
  )
}

function saveStatusLabel(status: SaveStatus) {
  if (status === 'saving') return 'Saving…'
  if (status === 'dirty') return 'Unsaved'
  if (status === 'conflict') return 'Changed on disk'
  if (status === 'error') return 'Save failed'
  return 'Saved'
}

function EditorToolbar({
  saveState,
  wordWrap,
  canPreview,
  preview,
  onReload,
  onRetry,
  onToggleWrap,
  onTogglePreview,
}: {
  readonly saveState: { readonly status: SaveStatus; readonly errorMessage: string | null }
  readonly wordWrap: boolean
  readonly canPreview: boolean
  readonly preview: boolean
  readonly onReload: () => void
  readonly onRetry: () => void
  readonly onToggleWrap: () => void
  readonly onTogglePreview: () => void
}) {
  const { status, errorMessage } = saveState
  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-2">
      <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
        <Save className="size-3" />
        <span
          className={status === 'conflict' || status === 'error' ? 'text-error' : undefined}
          title={errorMessage ?? undefined}
        >
          {saveStatusLabel(status)}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {status === 'conflict' && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onReload}
            leftIcon={<RotateCcw className="size-3" />}
          >
            Reload
          </Button>
        )}
        {status === 'error' && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onRetry}
            leftIcon={<Save className="size-3" />}
          >
            Retry
          </Button>
        )}
        <Button
          variant={wordWrap ? 'accent' : 'ghost'}
          size="icon-sm"
          title="Toggle word wrap"
          aria-label="Toggle word wrap"
          onClick={onToggleWrap}
        >
          <WrapText className="size-3.5" />
        </Button>
        {canPreview && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onTogglePreview}
            leftIcon={preview ? <Code2 className="size-3" /> : <Eye className="size-3" />}
          >
            {preview ? 'Edit' : 'Preview'}
          </Button>
        )}
      </div>
    </div>
  )
}

function TextEditor({
  content,
  file,
  gutterRef,
  textareaRef,
  wordWrap,
  onChange,
  onKeyDown,
  onScroll,
}: {
  readonly content: string
  readonly file: WorkspaceTextFileReadResult
  readonly gutterRef: RefObject<HTMLDivElement | null>
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>
  readonly wordWrap: boolean
  readonly onChange: ChangeEventHandler<HTMLTextAreaElement>
  readonly onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>
  readonly onScroll: UIEventHandler<HTMLTextAreaElement>
}) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div ref={gutterRef} className="shrink-0 overflow-hidden">
        <LineGutter content={content} />
      </div>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onScroll={onScroll}
        spellCheck={false}
        wrap={wordWrap ? 'soft' : 'off'}
        aria-label={`Edit ${file.path}`}
        className="min-h-0 min-w-0 flex-1 resize-none overflow-auto border-0 bg-bg p-3 font-mono text-[12px] leading-5 text-text-secondary outline-none selection:bg-accent/25"
      />
    </div>
  )
}

function EditorContent({
  file,
  editing,
}: {
  readonly file: WorkspaceTextFileReadResult
  readonly editing: ReturnType<typeof useWorkspaceFileEditing>
}) {
  if (editing.preview && file.previewKind === 'markdown') {
    return (
      <article className="prose prose-invert min-h-0 flex-1 overflow-auto p-6 text-[13px] text-text-secondary">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {editing.content}
        </ReactMarkdown>
      </article>
    )
  }
  if (editing.preview && file.previewKind === 'html') {
    return (
      <iframe
        title={`Preview ${file.basename}`}
        sandbox=""
        srcDoc={editing.content}
        className="min-h-0 flex-1 border-0 bg-white"
      />
    )
  }
  return (
    <TextEditor
      content={editing.content}
      file={file}
      gutterRef={editing.gutterRef}
      textareaRef={editing.textareaRef}
      wordWrap={editing.wordWrap}
      onChange={editing.handleChange}
      onKeyDown={editing.handleKeyDown}
      onScroll={editing.syncGutter}
    />
  )
}

export function WorkspaceFileEditor({
  projectPath,
  file,
  targetLine,
}: {
  readonly projectPath: string
  readonly file: WorkspaceTextFileReadResult
  readonly targetLine: number | null
}) {
  const editing = useWorkspaceFileEditing({ projectPath, file, targetLine })
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <EditorToolbar
        saveState={{ status: editing.status, errorMessage: editing.errorMessage }}
        wordWrap={editing.wordWrap}
        canPreview={editing.canPreview}
        preview={editing.preview}
        onReload={() => void editing.reloadFromDisk()}
        onRetry={() => void editing.saveSnapshot(editing.content)}
        onToggleWrap={editing.toggleWordWrap}
        onTogglePreview={() => editing.setPreview((current) => !current)}
      />
      <EditorContent file={file} editing={editing} />
    </div>
  )
}
