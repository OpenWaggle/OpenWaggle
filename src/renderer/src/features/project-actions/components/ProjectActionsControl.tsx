import type { ActionCatalog } from '@shared/types/action-definitions'
import { ChevronDown, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
import { useActionAvailability } from '../hooks/useActionAvailability'
import { useActionPreview } from '../hooks/useActionPreview'
import { useActionRuns, useActionScope, useNativeActions } from '../hooks/useNativeActions'
import { useRunProjectAction } from '../hooks/useRunProjectAction'
import { useProjectActionStore } from '../state/project-action-store'
import { NativeActionEditor } from './NativeActionEditor'
import { NativeActionsMenu } from './NativeActionsMenu'
import { ProjectActionGlyph } from './ProjectActionGlyph'

export function ProjectActionsControl({ projectPath }: { readonly projectPath: string | null }) {
  const scope = useActionScope(projectPath)
  const catalog = useNativeActions(scope)
  const runs = useActionRuns(scope)
  useActionPreview(scope, runs.data ?? [])
  const run = useRunProjectAction(projectPath)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const actions = catalog.data?.actions ?? []
  const primary = usePrimaryAction(projectPath, actions)
  const availability = useActionAvailability(scope, actions, runs.data ?? [])
  const unavailable = primary ? availability(primary) : undefined
  if (!scope) return null
  return (
    <>
      <div className="no-drag flex items-center gap-1">
        {primary ? (
          <Button
            variant="secondary"
            size="xs"
            className="h-7 max-w-36"
            title={unavailable ?? `Run ${primary.name}`}
            disabled={Boolean(unavailable)}
            aria-label={`Run ${primary.name}`}
            onClick={() => void run(primary)}
          >
            <ProjectActionGlyph icon={primary.icon} />
            <span className="truncate @max-[720px]/header:hidden">{primary.name}</span>
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="xs"
            className="h-7"
            onClick={() => setAdding(true)}
            disabled={!catalog.data}
          >
            <Plus className="size-3.5" />
            <span>Action</span>
          </Button>
        )}
        <Popover
          role="menu"
          open={open}
          onOpenChange={setOpen}
          placement="bottom-end"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Project actions"
              onClick={() => setOpen(!open)}
            >
              <ChevronDown className="size-3.5" />
            </Button>
          }
        >
          <NativeActionsMenu
            scope={scope}
            actions={actions}
            runs={runs.data ?? []}
            error={catalog.error?.message}
            canAdd={Boolean(catalog.data)}
            run={run}
            onClose={() => setOpen(false)}
            onAdd={() => setAdding(true)}
          />
        </Popover>
      </div>
      {adding && catalog.data ? (
        <NativeActionEditor
          key={`${scope.projectPath}:${scope.sessionId ?? ''}`}
          scope={scope}
          entry={null}
          revision={catalog.data.revision}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </>
  )
}

function usePrimaryAction(projectPath: string | null, actions: ActionCatalog['actions']) {
  const remembered = useProjectActionStore((state) =>
    projectPath ? state.lastInvokedByProject[projectPath] : null,
  )
  return (
    actions.find(({ definition }) => definition.id === remembered)?.definition ??
    actions[0]?.definition
  )
}
