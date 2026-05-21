import type { McpConfigSourceId, McpConfigSourceSummary } from '@shared/types/mcp'
import { FileJson2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Textarea } from '@/shared/ui/Textarea'

const RAW_EDITOR_ROWS = 16

interface McpSourceEditorProps {
  readonly selectedSource: McpConfigSourceSummary | null
  readonly rawJson: string
  readonly busy: boolean
  readonly onSave: () => void
  readonly onRawJsonChange: (sourceId: McpConfigSourceId, rawJson: string) => void
}

export function McpSourceEditor({
  selectedSource,
  rawJson,
  busy,
  onSave,
  onRawJsonChange,
}: McpSourceEditorProps) {
  return (
    <div className="rounded-lg border border-border bg-[#111418] p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileJson2 className="size-4 text-text-tertiary" />
            <h3 className="text-[16px] font-semibold text-text-primary">Edit selected source</h3>
          </div>
          <p className="mt-1 truncate text-[12px] text-text-tertiary">
            {selectedSource ? selectedSource.path : 'Select a source'}
          </p>
          {selectedSource?.parseError && (
            <p
              role="alert"
              className="mt-2 rounded-md border border-error/25 bg-error/6 px-3 py-2 text-[12px] text-error"
            >
              {selectedSource.parseError}
            </p>
          )}
        </div>
        <Button variant="accent" disabled={!selectedSource || busy} onClick={onSave}>
          Save JSON
        </Button>
      </div>
      <Textarea
        value={rawJson}
        rows={RAW_EDITOR_ROWS}
        spellCheck={false}
        variant="mono"
        resize="vertical"
        wrap="off"
        highlightLanguage="json"
        onChange={(event) => {
          if (!selectedSource) return
          onRawJsonChange(selectedSource.id, event.target.value)
        }}
      />
      <p className="mt-2 text-[11px] text-text-muted">
        Advanced config is preserved as JSON so every `pi-mcp-adapter` server and settings field
        remains available.
      </p>
    </div>
  )
}
