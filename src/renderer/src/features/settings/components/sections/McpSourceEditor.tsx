import type { McpConfigSourceId, McpConfigSourceSummary } from '@shared/types/mcp'
import { FileJson2 } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { formatDisplayPath, formatDisplayPathsInText } from '@/shared/lib/display-path'
import { tildifyPath } from '@/shared/lib/tildify-path'
import { Button } from '@/shared/ui/Button'
import { SourceView } from '@/shared/ui/SourceView'

const FocusedSourceEditor = lazy(() =>
  import('@/shared/ui/FocusedSourceEditor').then((module) => ({
    default: module.FocusedSourceEditor,
  })),
)

interface McpSourceEditorProps {
  readonly selectedSource: McpConfigSourceSummary | null
  readonly projectPath: string | null
  readonly rawJson: string
  readonly busy: boolean
  readonly onSave: () => void
  readonly onRawJsonChange: (sourceId: McpConfigSourceId, rawJson: string) => void
}

export function McpSourceEditor({
  selectedSource,
  projectPath,
  rawJson,
  busy,
  onSave,
  onRawJsonChange,
}: McpSourceEditorProps) {
  const editorProps = selectedSource
    ? {
        source: rawJson,
        path: selectedSource.path,
        language: 'json',
        cacheKey: `mcp-source:${selectedSource.id}`,
        wordWrap: false,
        className: 'min-h-0 flex-1',
        ariaLabel: 'MCP source JSON',
        onChange: (_changes: unknown, readSource: () => string) =>
          onRawJsonChange(selectedSource.id, readSource()),
        onSave,
      }
    : null
  return (
    <div className="rounded-lg border border-border bg-bg p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileJson2 className="size-4 text-text-tertiary" />
            <h3 className="text-base font-semibold text-text-primary">Edit selected source</h3>
          </div>
          <p className="mt-1 truncate text-xs text-text-tertiary">
            {selectedSource
              ? tildifyPath(formatDisplayPath(selectedSource.path, [projectPath]))
              : 'Select a source'}
          </p>
          {selectedSource?.parseError && (
            <p
              role="alert"
              className="mt-2 rounded-md border border-error/25 bg-error/6 px-3 py-2 text-xs text-error-text"
            >
              {formatDisplayPathsInText(selectedSource.parseError, [projectPath])}
            </p>
          )}
        </div>
        <Button variant="accent" disabled={!selectedSource || busy} onClick={onSave}>
          Save JSON
        </Button>
      </div>
      <div className="flex h-80 overflow-hidden rounded-lg border border-input-card-border bg-bg">
        {editorProps ? (
          <Suspense
            fallback={
              <SourceView
                source={rawJson}
                language="json"
                className="min-h-0 flex-1"
                ariaLabel="Loading MCP source JSON editor"
              />
            }
          >
            <FocusedSourceEditor {...editorProps} />
          </Suspense>
        ) : (
          <SourceView
            source={rawJson}
            language="json"
            className="min-h-0 flex-1 opacity-60"
            ariaLabel="MCP source JSON"
          />
        )}
      </div>
      <p className="mt-2 text-xs text-text-muted">
        OpenWaggle preserves unknown fields for forward compatibility and reports any fields the
        current runtime cannot apply. Protocol pins and legacy compatibility profiles remain
        available here.
      </p>
    </div>
  )
}
