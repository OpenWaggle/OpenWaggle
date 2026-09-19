import type { AgentDefinitionImportPlan } from '@shared/types/agent-definition-management'
import { includes } from '@shared/utils/validation'
import { FileSearch, FolderOpen } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { Select } from '@/shared/ui/Select'
import { TextInput } from '@/shared/ui/TextInput'
import {
  IMPORT_SCOPES,
  IMPORT_SOURCES,
  SOURCE_LABELS,
  useAgentDefinitionImport,
} from './use-agent-definition-import'

interface AgentDefinitionImportDialogProps {
  readonly projectPath: string
  readonly onClose: () => void
  readonly onImported: () => Promise<void>
}

function ImportPlanReview({ plan }: { readonly plan: AgentDefinitionImportPlan }) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-bg-secondary p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-primary">
            {plan.document?.name ?? 'Definition needs input'}
          </p>
          <p className="truncate text-xs text-text-tertiary" title={plan.destinationPath}>
            {plan.destinationPath}
          </p>
        </div>
        <span className="rounded border border-border-light px-1.5 py-0.5 text-xs text-text-secondary">
          {plan.status}
        </span>
      </div>
      {plan.diagnostics.length > 0 ? (
        <div className="space-y-1 text-xs text-error-text" role="alert">
          {plan.diagnostics.map((diagnostic) => (
            <p key={diagnostic}>{diagnostic}</p>
          ))}
        </div>
      ) : null}
      <div className="max-h-52 divide-y divide-border overflow-y-auto rounded border border-border">
        {plan.fields.map((field) => (
          <div
            className="grid grid-cols-[7rem_6rem_1fr] gap-2 px-2 py-1.5 text-xs"
            key={`${field.sourceField}:${field.targetField ?? ''}`}
          >
            <span className="truncate font-mono text-text-secondary" title={field.sourceField}>
              {field.sourceField}
            </span>
            <span className="text-text-tertiary">{field.disposition}</span>
            <span className="text-text-tertiary">{field.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AgentDefinitionImportDialog(props: AgentDefinitionImportDialogProps) {
  const state = useAgentDefinitionImport(props)

  return (
    <ModalDialog labelledBy="agent-definition-import-title" onClose={props.onClose}>
      <form
        className="max-h-dvh w-full max-w-3xl space-y-4 overflow-y-auto p-5"
        onSubmit={(event) => {
          event.preventDefault()
          void state.submit()
        }}
      >
        <div className="flex items-center gap-2">
          <FileSearch className="size-4 text-accent" />
          <h3 className="text-base font-semibold" id="agent-definition-import-title">
            Import Agent definition
          </h3>
        </div>
        <div className="flex gap-2">
          <TextInput
            aria-label="Source file"
            className="min-w-0 flex-1 font-mono"
            placeholder="Choose a Markdown or TOML file"
            value={state.sourcePath}
            onChange={(event) => {
              state.setSourcePath(event.currentTarget.value)
              state.invalidatePlan()
            }}
          />
          <Button aria-label="Choose source file" onClick={() => void state.chooseSource()}>
            <FolderOpen className="size-3.5" />
            Choose
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="space-y-1 text-xs text-text-secondary" htmlFor="agent-import-source">
            Source format
            <Select
              className="w-full"
              id="agent-import-source"
              value={state.sourceTool}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (includes(IMPORT_SOURCES, value)) state.setSourceTool(value)
                state.invalidatePlan()
              }}
            >
              {IMPORT_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {SOURCE_LABELS[source]}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-xs text-text-secondary" htmlFor="agent-import-name">
            Source Agent name
            <TextInput
              id="agent-import-name"
              placeholder="Only for multi-Agent files"
              value={state.sourceName}
              onChange={(event) => {
                state.setSourceName(event.currentTarget.value)
                state.invalidatePlan()
              }}
            />
          </label>
          <label className="space-y-1 text-xs text-text-secondary" htmlFor="agent-import-scope">
            Destination scope
            <Select
              className="w-full"
              id="agent-import-scope"
              value={state.targetScope}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (includes(IMPORT_SCOPES, value)) state.setTargetScope(value)
                state.invalidatePlan()
              }}
            >
              <option value="project">Project</option>
              <option value="portable-project">Portable project</option>
              <option value="user">User</option>
            </Select>
          </label>
        </div>
        {state.plan ? <ImportPlanReview plan={state.plan} /> : null}
        {state.needsReplacement ? (
          <Checkbox
            checked={state.replaceExisting}
            label="Replace the existing definition after reviewing the field mapping"
            onChange={(event) => state.setReplaceExisting(event.currentTarget.checked)}
          />
        ) : null}
        {state.error ? (
          <p className="text-xs text-error-text" role="alert">
            {state.error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button disabled={state.working} onClick={props.onClose}>
            Cancel
          </Button>
          {state.plan ? (
            <Button disabled={state.working || !state.canApply} type="submit" variant="primary">
              {state.working ? 'Importing…' : 'Import'}
            </Button>
          ) : (
            <Button disabled={state.working} type="submit" variant="primary">
              {state.working ? 'Reading…' : 'Review import'}
            </Button>
          )}
        </div>
      </form>
    </ModalDialog>
  )
}
