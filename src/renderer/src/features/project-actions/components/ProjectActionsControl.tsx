import { ChevronDown, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
import { useActionPreview } from '../hooks/useActionPreview'
import { useActionRuns, useActionScope, useNativeActions } from '../hooks/useNativeActions'
import { useRunProjectAction } from '../hooks/useRunProjectAction'
import { NativeActionEditor } from './NativeActionEditor'
import { NativeActionsMenu } from './NativeActionsMenu'

export function ProjectActionsControl({ projectPath }: { readonly projectPath: string | null }) {
  const scope = useActionScope(projectPath)
  const catalog = useNativeActions(scope)
  const runs = useActionRuns(scope)
  useActionPreview(scope, runs.data ?? [])
  const run = useRunProjectAction(projectPath)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  if (!scope) return null
  return (
    <>
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
