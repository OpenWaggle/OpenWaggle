import type {
  ActionCatalog,
  ActionCatalogEdit,
  ActionDefinition,
  EffectiveDefinition,
} from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { isActiveActionRun } from '@shared/types/action-runs'
import { FolderOpen, Plus } from 'lucide-react'
import { useState } from 'react'
import { useResourceProject } from '@/features/settings'
import { Button } from '@/shared/ui/Button'
import { ProjectPicker } from '@/shared/ui/ProjectPicker'
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
  const project = useResourceProject()
  return (
    <div className="w-full min-w-0 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Project actions</h2>
          <p className="mt-2 text-sm text-text-tertiary">Save commands for each project.</p>
        </div>
        <ProjectPicker
          resourceName="actions"
          projects={project.projects}
          selectedProject={project.projectPath}
          displayNames={project.displayNames}
          onSelect={project.setSelectedProject}
          onOpenFolder={() => void project.openFolder()}
          loadProjectsPage={project.loadProjectsPage}
        />
      </header>
      {project.folderError ? (
        <p role="alert" className="text-sm text-error-text">
          {project.folderError}
        </p>
      ) : null}
      {project.projectPath ? (
        <ProjectActionDefinitions key={project.projectPath} projectPath={project.projectPath} />
      ) : (
        <section className="space-y-3 rounded-xl border border-border p-6">
          <h3 className="text-sm font-medium">Choose a project to manage its actions</h3>
          <p className="text-sm text-text-tertiary">
            Choose a project above or open a project folder.
          </p>
          <Button variant="primary" onClick={() => void project.openFolder()}>
            <FolderOpen className="size-4" />
            Open project folder
          </Button>
        </section>
      )}
    </div>
  )
}

function ProjectActionDefinitions({ projectPath }: { readonly projectPath: string }) {
  const scope: ActionManagementScope = { projectPath }
  const runScope = useActionScope(projectPath)
  const catalog = useNativeActions(scope)
  const runs = useActionRuns(runScope)
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
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-text-primary">
          Saved actions {catalog.data ? `(${catalog.data.actions.length})` : ''}
        </h3>
        <Button
          variant="primary"
          className="min-h-9"
          disabled={!catalog.data}
          onClick={() => setEditor(null)}
        >
          <Plus className="size-4" />
          Add action
        </Button>
      </div>
      {runScope ? <RunningActionsLink scope={runScope} runs={running} /> : null}
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
        <div className="space-y-3 p-6">
          <p className="text-sm text-text-secondary">
            No saved actions yet. Add a command you use in this project.
          </p>
          <Button variant="secondary" onClick={() => onEdit(null)}>
            Add your first action
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
