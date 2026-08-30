import type { SessionDetail } from '@shared/types/session'
import type { BoundWorkspaceResource } from '../../../store/session-details'
import { validateSessionWorktreeBirthAuthority } from '../../../store/session-details'

export function validateWorkspaceBirthAuthority(
  session: SessionDetail,
  workspace: BoundWorkspaceResource,
  plannedWorkingPath: string,
) {
  return validateSessionWorktreeBirthAuthority({
    sessionId: session.id,
    workspaceId: workspace.id,
    projectPath: workspace.projectPath,
    plannedWorkingPath,
  })
}
