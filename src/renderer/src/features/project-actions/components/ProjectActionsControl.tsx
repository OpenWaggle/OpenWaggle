import type { ProjectAction, ProjectActionInput } from '@shared/types/project-actions'
import { ChevronDown, Plus } from 'lucide-react'
import { useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
import { useUIStore } from '@/shell/ui-store'
import {
  useProjectActionMutations,
  useProjectActions,
  useT3ProjectActions,
} from '../hooks/useProjectActions'
import { useRunProjectAction } from '../hooks/useRunProjectAction'
import { primaryProjectAction } from '../lib/project-action-model'
import { useProjectActionStore } from '../state/project-action-store'
import { ProjectActionEditorDialog } from './ProjectActionEditorDialog'
import { ProjectActionGlyph } from './ProjectActionGlyph'
import { ProjectActionsMenu } from './ProjectActionsMenu'

interface ProjectActionsControlProps {
  readonly projectPath: string | null
}

function ProjectActionLabel({
  children,
  primary = false,
}: {
  readonly children: string
  readonly primary?: boolean
}) {
  return (
    <span
      className={cn('truncate text-xs @max-[720px]/header:hidden', primary && 'text-text-primary')}
    >
      {children}
    </span>
  )
}

export function ProjectActionsControl({ projectPath }: ProjectActionsControlProps) {
  const actionsQuery = useProjectActions(projectPath)
  const discoveryQuery = useT3ProjectActions(projectPath)
  const mutations = useProjectActionMutations(projectPath)
  const runAction = useRunProjectAction(projectPath)
  const builtInBindings = usePreferencesStore((state) => state.settings.shortcutRules)
  const showToast = useUIStore((state) => state.showToast)
  const lastInvokedId = useProjectActionStore((state) =>
    projectPath === null ? null : (state.lastInvokedByProject[projectPath] ?? null),
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const [editorAction, setEditorAction] = useState<ProjectAction | null | undefined>(undefined)
  if (projectPath === null) return null

  const actions = actionsQuery.data ?? []
  const candidates = discoveryQuery.data?.status === 'valid' ? discoveryQuery.data.candidates : []
  const primary = primaryProjectAction(actions, lastInvokedId)

  function closeMenuThen(action: () => void) {
    setMenuOpen(false)
    action()
  }

  async function importT3(sourceIndex: number) {
    setMenuOpen(false)
    try {
      await mutations.importT3(sourceIndex)
      showToast('Action imported from t3.json.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not import action.', 'error')
    }
  }

  async function saveAction(input: ProjectActionInput) {
    if (editorAction === undefined) return
    if (editorAction === null) await mutations.add(input)
    else await mutations.update(editorAction.id, input)
  }

  const menu = (
    <Popover
      role="menu"
      open={menuOpen}
      onOpenChange={setMenuOpen}
      placement="bottom-end"
      className="no-drag"
      trigger={
        <Button
          variant="secondary"
          size="none"
          aria-label="Project actions"
          onClick={() => setMenuOpen((open) => !open)}
          className="no-drag h-7 px-1.5"
        >
          {primary === null ? <Plus className="size-3.5" /> : null}
          <ChevronDown className="size-3.5 text-text-tertiary" />
        </Button>
      }
    >
      <ProjectActionsMenu
        model={{
          actions,
          candidates,
          discovery: discoveryQuery.data,
          builtInBindings,
          saving: mutations.isSaving,
        }}
        handlers={{
          run: (action) => closeMenuThen(() => void runAction(action)),
          edit: (action) => closeMenuThen(() => setEditorAction(action)),
          importT3: (sourceIndex) => void importT3(sourceIndex),
          add: () => closeMenuThen(() => setEditorAction(null)),
        }}
      />
    </Popover>
  )

  return (
    <>
      {primary !== null ? (
        <div className="no-drag flex items-center">
          <Button
            variant="secondary"
            size="none"
            aria-label={`Run ${primary.name}`}
            title={`Run ${primary.name}`}
            onClick={() => void runAction(primary)}
            className="no-drag h-7 max-w-36 gap-1.5 rounded-r-none border-r-0 px-2"
          >
            <ProjectActionGlyph icon={primary.icon} />
            <ProjectActionLabel primary>{primary.name}</ProjectActionLabel>
          </Button>
          {menu}
        </div>
      ) : candidates.length > 0 || discoveryQuery.data?.status === 'invalid' ? (
        menu
      ) : (
        <Button
          variant="secondary"
          size="none"
          aria-label="Add project action"
          title="Add project action"
          onClick={() => setEditorAction(null)}
          className="no-drag h-7 px-2"
        >
          <Plus className="size-3.5" />
          <ProjectActionLabel>Action</ProjectActionLabel>
        </Button>
      )}

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
    </>
  )
}
