import { useChat } from '@/features/chat/hooks'
import { ProjectActionsSurface } from '@/features/project-actions'
import { useProject } from '@/features/sessions/hooks'
import type { TerminalOwnerContext } from '@/features/terminal'
import { useWorkspacePanelStore } from '../workspace-panel-store'

/** Hosts the Project Actions surface for the Session's workspace (ADR 0043). */
export function WorkspaceProjectActionsSurface({
  owner,
}: {
  readonly owner: TerminalOwnerContext
}) {
  const { activeSession } = useChat()
  const { projectPath } = useProject()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-bg">
      <ProjectActionsSurface
        projectPath={projectPath ?? null}
        sessionId={activeSession ? String(activeSession.id) : null}
        onShowRunOutput={({ projectPath: runProjectPath, runId }) =>
          useWorkspacePanelStore.getState().showAction(owner.ownerKey, runProjectPath, runId)
        }
      />
    </div>
  )
}
