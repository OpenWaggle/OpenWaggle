import { ChevronDown, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
import { useActionPreview } from '../hooks/useActionPreview'
import { useActionRuns, useActionScope, useNativeActions } from '../hooks/useNativeActions'
import { useRunProjectAction } from '../hooks/useRunProjectAction'
import { useActionPanelStore } from '../state/action-panel-store'
import { requestForDraft } from './action-panel/panel-requests'
import { NativeActionsMenu } from './NativeActionsMenu'

export function ProjectActionsControl({ projectPath }: { readonly projectPath: string | null }) {
  const scope = useActionScope(projectPath)
  const catalog = useNativeActions(scope)
  const runs = useActionRuns(scope)
  useActionPreview(scope, runs.data ?? [])
  const run = useRunProjectAction(projectPath)
  const [open, setOpen] = useState(false)
  if (!scope) return null
  const openPanel = useActionPanelStore.getState().openPanel
  return (
    <div className="no-drag">
      <Popover
        role="menu"
        open={open}
        onOpenChange={setOpen}
        placement="bottom-end"
        escapeClipping
        trigger={
          <Button
            variant="secondary"
            size="xs"
            className="h-7"
            aria-label="Project actions"
            onClick={() => setOpen(!open)}
          >
            <Plus className="size-3.5" />
            <span>Action</span>
            <ChevronDown className="size-3.5" />
          </Button>
        }
      >
        <NativeActionsMenu
          scope={scope}
          actions={catalog.data?.actions ?? []}
          runs={runs.data ?? []}
          error={catalog.error?.message}
          canAdd={Boolean(catalog.data)}
          run={run}
          onClose={() => setOpen(false)}
          panel={{
            onAdd: () => openPanel({ kind: 'action', scope, actionId: null, origin: 'session' }),
            onContinue: () => {
              const draft = useActionPanelStore.getState().drafts[scope.projectPath]
              if (draft) openPanel(requestForDraft(draft, scope, 'session'))
            },
          }}
        />
      </Popover>
    </div>
  )
}
