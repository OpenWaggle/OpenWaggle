import type { AgentDefinitionCatalogItem } from '@shared/types/agent-definition'
import { Bot, Copy, FileDown, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { Button } from '@/shared/ui/Button'
import { AgentDefinitionEditorDialog } from './AgentDefinitionEditorDialog'
import { AgentDefinitionImportDialog } from './AgentDefinitionImportDialog'
import { useAgentDefinitions } from './use-agent-definitions'

interface EditorState {
  readonly source?: AgentDefinitionCatalogItem
  readonly duplicate?: boolean
}

function DefinitionRow(props: {
  readonly item: AgentDefinitionCatalogItem
  readonly onEdit: () => void
  readonly onDuplicate: () => void
  readonly onDelete: () => void
  readonly onRefresh: () => void
}) {
  const { item } = props
  const imported = item.definition?.import
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 border-t border-border px-4 py-2 first:border-t-0">
      <div className="flex min-w-0 items-start gap-2.5">
        <Bot className="mt-0.5 size-4 shrink-0 text-text-tertiary" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-text-primary">{item.name}</span>
            <span className="rounded border border-border-light px-1 py-0.5 text-xs text-text-tertiary">
              {item.scope}
            </span>
            {imported ? (
              <span className="rounded border border-accent/25 bg-accent/5 px-1 py-0.5 text-xs text-accent">
                imported · {imported.sourceTool}
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-text-tertiary" title={item.sourcePath}>
            {item.loadError ?? item.description}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {imported ? (
          <Button
            aria-label={`Refresh ${item.name}`}
            size="icon-sm"
            title="Refresh from import source"
            variant="ghost"
            onClick={props.onRefresh}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        ) : null}
        <Button
          aria-label={`Edit ${item.name}`}
          disabled={!item.definition}
          size="icon-sm"
          title="Edit"
          variant="ghost"
          onClick={props.onEdit}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          aria-label={`Duplicate ${item.name}`}
          disabled={!item.definition}
          size="icon-sm"
          title="Duplicate"
          variant="ghost"
          onClick={props.onDuplicate}
        >
          <Copy className="size-3.5" />
        </Button>
        <Button
          aria-label={`Delete ${item.name}`}
          size="icon-sm"
          title="Delete"
          variant="ghost"
          onClick={props.onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

export function AgentDefinitionsCard() {
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const definitions = useAgentDefinitions(projectPath)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [importing, setImporting] = useState(false)

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-text-primary">Agent definitions</h3>
            <span className="rounded-md border border-border-light px-1.5 py-0.5 text-xs text-text-tertiary">
              {definitions.items.length}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-tertiary">
            Optional reusable roles for new Sessions. Queen and Worker lineage remains separate.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={!projectPath}
            size="xs"
            variant="secondary"
            onClick={() => setImporting(true)}
          >
            <FileDown className="size-3.5" />
            Import
          </Button>
          <Button disabled={!projectPath} size="xs" onClick={() => setEditor({})}>
            <Plus className="size-3.5" />
            New
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-bg">
        {!projectPath ? (
          <p className="px-4 py-5 text-xs text-text-tertiary">
            Open a project to manage project, portable, and user Agent definitions together.
          </p>
        ) : definitions.loading ? (
          <p className="px-4 py-5 text-xs text-text-tertiary">Loading Agent definitions…</p>
        ) : definitions.items.length === 0 ? (
          <p className="px-4 py-5 text-xs text-text-tertiary">
            No definitions yet. The normal default Agent remains available without one.
          </p>
        ) : (
          definitions.items.map((item) => (
            <DefinitionRow
              item={item}
              key={`${item.scope}:${item.sourcePath}`}
              onDelete={() => void definitions.remove(item)}
              onDuplicate={() => setEditor({ source: item, duplicate: true })}
              onEdit={() => setEditor({ source: item })}
              onRefresh={() => void definitions.refresh(item)}
            />
          ))
        )}
      </div>
      {definitions.error ? (
        <p className="text-xs text-error-text" role="alert">
          {definitions.error}
        </p>
      ) : null}
      {editor && projectPath ? (
        <AgentDefinitionEditorDialog
          {...editor}
          onClose={() => setEditor(null)}
          onSave={async (input) => {
            await definitions.mutate({
              operation: 'write',
              projectPath,
              ...input,
            })
          }}
        />
      ) : null}
      {importing && projectPath ? (
        <AgentDefinitionImportDialog
          projectPath={projectPath}
          onClose={() => setImporting(false)}
          onImported={definitions.reload}
        />
      ) : null}
    </div>
  )
}
