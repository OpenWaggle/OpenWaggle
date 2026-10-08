import { ProjectActionsSurface } from '@/features/project-actions'
import { useSessionProjectPath } from '@/features/sessions/hooks'
import type { TerminalOwnerContext } from '@/features/terminal'
import { useWorkspacePanelStore } from '../workspace-panel-store'

/** Hosts the Project Actions surface for the Session's workspace (ADR 0043). */
export function WorkspaceProjectActionsSurface({
  owner,
}: {
  readonly owner: TerminalOwnerContext
}) {
  const projectPath = useSessionProjectPath()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-bg">
      <ProjectActionsSurface
        projectPath={projectPath}
        onShowRunOutput={({ projectPath: runProjectPath, runId }) =>
          useWorkspacePanelStore.getState().showAction(owner.ownerKey, runProjectPath, runId)
        }
      />
    </div>
  )
}
