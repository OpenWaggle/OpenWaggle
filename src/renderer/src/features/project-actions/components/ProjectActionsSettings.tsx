import type { ProjectAction, ProjectActionInput } from '@shared/types/project-actions'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useProject } from '@/features/sessions/hooks'
import { usePreferencesStore } from '@/features/settings/state'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import {
  useProjectActionMutations,
  useProjectActions,
  useT3ProjectActions,
} from '../hooks/useProjectActions'
import { ProjectActionEditorDialog } from './ProjectActionEditorDialog'
import { ProjectActionSettingsRow } from './ProjectActionSettingsRow'
import { T3ProjectActionImports } from './T3ProjectActionImports'

export function ProjectActionsSettings() {
  const { projectPath } = useProject()
  const builtInBindings = usePreferencesStore((state) => state.settings.shortcutRules)
  const showToast = useUIStore((state) => state.showToast)
  const actionsQuery = useProjectActions(projectPath)
  const discoveryQuery = useT3ProjectActions(projectPath)
  const mutations = useProjectActionMutations(projectPath)
  const [editorAction, setEditorAction] = useState<ProjectAction | null | undefined>(undefined)
  const actions = actionsQuery.data ?? []

  async function saveAction(input: ProjectActionInput) {
    if (editorAction === undefined) return
    if (editorAction === null) await mutations.add(input)
    else await mutations.update(editorAction.id, input)
  }

  async function importAction(sourceIndex: number) {
    try {
      await mutations.importT3(sourceIndex)
      showToast('Action imported from t3.json.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not import action.', 'error')
    }
  }

  if (projectPath === null) {
    return (
      <div className="max-w-3xl">
        <h2 className="text-base font-semibold text-text-primary">Project actions</h2>
        <p className="mt-1 text-xs text-text-tertiary">
          Open a project to configure commands, setup actions, previews, and shortcuts.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-5">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Project actions</h2>
          <p className="mt-1 text-xs leading-5 text-text-tertiary">
            Saved in this project and run in the active Session Working path.
          </p>
        </div>
        <Button
          variant="secondary"
          size="xs"
          disabled={mutations.isSaving}
          onClick={() => setEditorAction(null)}
        >
          <Plus className="size-3" />
          Add action
        </Button>
      </div>

      <section className="space-y-2" aria-labelledby="t3-action-imports-heading">
        <h3 id="t3-action-imports-heading" className="text-sm font-medium text-text-primary">
          Import from t3.json
        </h3>
        <T3ProjectActionImports
          discovery={discoveryQuery.data}
          saving={mutations.isSaving}
          onImport={(sourceIndex) => void importAction(sourceIndex)}
        />
      </section>

      <section className="space-y-2" aria-labelledby="saved-project-actions-heading">
        <h3 id="saved-project-actions-heading" className="text-sm font-medium text-text-primary">
          Saved actions
        </h3>
        {actionsQuery.isError ? (
          <p role="alert" className="text-xs text-error-text">
            {actionsQuery.error.message}
          </p>
        ) : actions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-text-muted">
            No actions configured for this project.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-bg-secondary">
            {actions.map((action) => (
              <ProjectActionSettingsRow
                key={action.id}
                action={action}
                actions={actions}
                builtInBindings={builtInBindings}
                onEdit={setEditorAction}
              />
            ))}
          </div>
        )}
      </section>

      {editorAction !== undefined ? (
        <ProjectActionEditorDialog
          key={editorAction?.id ?? 'new'}
          action={editorAction}
          actions={actions}
          builtInBindings={builtInBindings}
          saving={mutations.isSaving}
          onSave={saveAction}
          onDelete={async (actionId) => {
            await mutations.delete(actionId)
          }}
          onClose={() => setEditorAction(undefined)}
        />
      ) : null}
    </div>
  )
}
