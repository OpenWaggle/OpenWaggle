import type { WorkspaceTextFileReadResult } from '@shared/types/workspace-files'
import { lazy, Suspense } from 'react'
import { Button } from '@/shared/ui/Button'
import { MarkdownDocument } from '@/shared/ui/MarkdownDocument'
import { SourceView } from '@/shared/ui/SourceView'
import type { useWorkspaceFileEditing } from '../hooks/useWorkspaceFileEditing'

type WorkspaceFileEditing = ReturnType<typeof useWorkspaceFileEditing>
const FocusedSourceEditor = lazy(() =>
  import('@/shared/ui/FocusedSourceEditor').then((module) => ({
    default: module.FocusedSourceEditor,
  })),
)

function ConflictComparison({ editing }: { readonly editing: WorkspaceFileEditing }) {
  if (editing.conflictDiskContent === null) return null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 items-center justify-between border-b border-border px-3 text-xs text-text-muted">
        <span>Disk version compared with recovered draft</span>
        <Button variant="ghost" size="xs" onClick={editing.dismissComparison}>
          Back to editor
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border overflow-hidden">
        {[
          { label: 'Disk', source: editing.conflictDiskContent },
          { label: 'Draft', source: editing.content },
        ].map((version) => (
          <div key={version.label} className="min-w-0 overflow-auto">
            <p className="sticky top-0 z-10 bg-bg-secondary px-3 py-1.5 text-xs text-text-muted">
              {version.label}
            </p>
            <SourceView
              source={version.source}
              language={editing.language}
              className="min-h-full bg-bg"
              ariaLabel={`${version.label} version`}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function LineEndingNormalization({
  editing,
  onNormalizeLineEndings,
}: {
  readonly editing: WorkspaceFileEditing
  readonly onNormalizeLineEndings: (lineEnding: 'lf' | 'crlf') => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-warning/30 bg-warning/10 p-3 text-xs text-text-secondary">
        <p className="font-medium text-warning">Mixed line endings need an explicit choice</p>
        <p className="mt-1 leading-5">
          Choose how OpenWaggle should normalize this file before editing. Its encoding and
          final-newline state remain intact.
        </p>
        <div className="mt-2 flex gap-2">
          <Button size="xs" variant="accent" onClick={() => onNormalizeLineEndings('lf')}>
            Normalize to LF
          </Button>
          <Button size="xs" variant="ghost" onClick={() => onNormalizeLineEndings('crlf')}>
            Normalize to CRLF
          </Button>
        </div>
      </div>
      <SourceView
        source={editing.content}
        language={editing.language}
        className="min-h-0 flex-1 bg-bg"
        ariaLabel="Source awaiting line-ending normalization"
      />
    </div>
  )
}

function WorkspaceDocumentEditor({
  file,
  projectPath,
  targetLine,
  editing,
}: {
  readonly file: WorkspaceTextFileReadResult
  readonly projectPath: string
  readonly targetLine: number | null
  readonly editing: WorkspaceFileEditing
}) {
  const editorProps = {
    source: editing.content,
    path: file.path,
    language: editing.language,
    cacheKey: `${projectPath}\u0000${file.path}\u0000${editing.editorRevision}`,
    targetLine,
    wordWrap: editing.wordWrap,
    className: 'min-h-0 flex-1',
    ariaLabel: `Edit ${file.path}`,
    onChange: editing.handleChange,
    onSave: () => void editing.saveSnapshot(),
  }
  return <FocusedSourceEditor key={editing.editorRevision} {...editorProps} />
}

export function WorkspaceFileEditorContent({
  file,
  projectPath,
  targetLine,
  editing,
  focusedEdit,
  onNormalizeLineEndings,
}: {
  readonly file: WorkspaceTextFileReadResult
  readonly projectPath: string
  readonly targetLine: number | null
  readonly editing: WorkspaceFileEditing
  readonly focusedEdit: boolean
  readonly onNormalizeLineEndings: (lineEnding: 'lf' | 'crlf') => void
}) {
  if (editing.conflictDiskContent !== null) return <ConflictComparison editing={editing} />
  if (focusedEdit && editing.normalizationRequired)
    return (
      <LineEndingNormalization editing={editing} onNormalizeLineEndings={onNormalizeLineEndings} />
    )
  if (editing.preview && file.previewKind === 'markdown') {
    return (
      <article className="min-h-0 flex-1 overflow-auto p-6">
        <MarkdownDocument>{editing.content}</MarkdownDocument>
      </article>
    )
  }
  if (editing.preview && file.previewKind === 'html') {
    return (
      <iframe
        title={`Preview ${file.basename}`}
        sandbox=""
        srcDoc={editing.content}
        className="min-h-0 flex-1 border-0 bg-text-primary"
      />
    )
  }
  if (!focusedEdit) {
    return (
      <SourceView
        source={editing.content}
        language={editing.language}
        path={file.path}
        targetLine={targetLine}
        className="min-h-0 flex-1"
        ariaLabel={`Source for ${file.path}`}
      />
    )
  }
  return (
    <Suspense
      fallback={
        <SourceView
          source={editing.content}
          language={editing.language}
          path={file.path}
          targetLine={targetLine}
          className="min-h-0 flex-1"
          ariaLabel={`Loading editor for ${file.path}`}
        />
      }
    >
      <WorkspaceDocumentEditor
        file={file}
        projectPath={projectPath}
        targetLine={targetLine}
        editing={editing}
      />
    </Suspense>
  )
}
