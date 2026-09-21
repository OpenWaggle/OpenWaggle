import type {
  ActionCatalog,
  ActionCatalogEdit,
  ActionDefinition,
  EffectiveDefinition,
} from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { isActiveActionRun } from '@shared/types/action-runs'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useProject } from '@/features/sessions/hooks'
import { Button } from '@/shared/ui/Button'
import { useActionAvailability } from '../hooks/useActionAvailability'
import {
  useActionRuns,
  useActionScope,
  useEditActionCatalog,
  useNativeActions,
} from '../hooks/useNativeActions'
import { NativeActionEditor } from './NativeActionEditor'
import { ActionPublicationRecovery, NativeActionSettingsRow } from './NativeActionSettingsRow'
import { PreparationSettings } from './PreparationSettings'
import { RunningActionsLink } from './RunningActionsLink'

export function ProjectActionsSettings() {
  const { projectPath } = useProject()
  const scope = useActionScope(projectPath)
  const catalog = useNativeActions(scope)
  const runs = useActionRuns(scope)
  const edit = useEditActionCatalog(scope)
  const [editor, setEditor] = useState<EffectiveDefinition<ActionDefinition> | null | undefined>(
    undefined,
  )
  const [error, setError] = useState<string | null>(null)
  const availability = useActionAvailability(scope, catalog.data?.actions ?? [], runs.data ?? [])
  const running = (runs.data ?? []).filter(isActiveActionRun)
  async function apply(change: ActionCatalogEdit) {
    if (!catalog.data) return
    setError(null)
    try {
      await edit.mutateAsync({ revision: catalog.data.revision, edit: change })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update actions.')
    }
  }
  if (!scope)
    return (
      <div>
        <h2 className="text-base font-semibold">Project actions</h2>
        <p className="mt-2 text-sm text-text-tertiary">Open a project to manage its actions.</p>
      </div>
    )
  return (
    <div className="max-w-3xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Project actions</h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-text-tertiary">
            Commands for this project, ready to run from any session. Keep them private or choose
            which ones to share.
          </p>
        </div>
        <Button
          variant="primary"
          className="min-h-9"
          disabled={!catalog.data}
          onClick={() => setEditor(null)}
        >
          <Plus className="size-4" />
          Add action
        </Button>
      </header>
      <RunningActionsLink scope={scope} runs={running} />
      {catalog.error || error ? (
        <p role="alert" className="text-sm text-error-text">
          {error ?? catalog.error?.message}
        </p>
      ) : null}
      {catalog.data?.pendingPublication ? (
        <ActionPublicationRecovery
          pending={catalog.data.pendingPublication}
          busy={edit.isPending}
          onDiscard={() => void apply({ type: 'discard-publication' })}
        />
      ) : null}
      <SavedProjectActions
        catalog={catalog.data}
        loading={catalog.isPending}
        busy={edit.isPending}
        availability={availability}
        onEdit={setEditor}
        apply={apply}
      />
      <p className="text-xs leading-5 text-text-tertiary">
        Running processes and their output live in the Session Hub. Changes here apply the next time
        an action starts.
      </p>
      {catalog.data ? <PreparationSettings scope={scope} catalog={catalog.data} /> : null}
      <SettingsActionEditor
        scope={scope}
        catalog={catalog.data}
        editor={editor}
        onClose={() => setEditor(undefined)}
      />
    </div>
  )
}

function SavedProjectActions({
  catalog,
  loading,
  busy,
  availability,
  onEdit,
  apply,
}: {
  readonly catalog: ActionCatalog | undefined
  readonly loading: boolean
  readonly busy: boolean
  readonly availability: (definition: ActionDefinition) => string | undefined
  readonly onEdit: (entry: EffectiveDefinition<ActionDefinition> | null) => void
  readonly apply: (edit: ActionCatalogEdit) => Promise<void>
}) {
  return (
    <section aria-label="Saved actions" className="overflow-hidden rounded-xl border border-border">
      {loading ? <p className="p-5 text-sm text-text-tertiary">Loading actions…</p> : null}
      {catalog?.actions.length === 0 ? (
        <div className="space-y-3 p-8 text-center">
          <p className="text-sm text-text-secondary">
            Your project’s everyday commands, one click away.
          </p>
          <Button variant="secondary" onClick={() => onEdit(null)}>
            Choose a project task
          </Button>
        </div>
      ) : null}
      {catalog?.actions.map((entry) => (
        <NativeActionSettingsRow
          key={entry.definition.id}
          entry={entry}
          busy={busy}
          unavailable={availability(entry.definition)}
          onEdit={() => onEdit(entry)}
          apply={apply}
        />
      ))}
    </section>
  )
}

function SettingsActionEditor({
  scope,
  catalog,
  editor,
  onClose,
}: {
  readonly scope: ActionManagementScope
  readonly catalog: ActionCatalog | undefined
  readonly editor: EffectiveDefinition<ActionDefinition> | null | undefined
  readonly onClose: () => void
}) {
  return (
    <>
      {' '}
      {editor !== undefined && catalog ? (
        <NativeActionEditor
          key={`${scope.projectPath}:${scope.sessionId ?? ''}:${editor?.definition.id ?? 'new'}`}
          scope={scope}
          entry={editor}
          revision={catalog.revision}
          onClose={() => onClose()}
        />
      ) : null}
    </>
  )
}
