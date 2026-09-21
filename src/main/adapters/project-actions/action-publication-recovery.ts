import type { PendingActionPublication } from '../../domain/project-action-catalog'
import {
  actionContentRevision,
  readActionManifest,
  readActionWorkspaceIdentity,
  serializeActionManifest,
  writeActionManifest,
} from './action-manifest-file'
import type { ActionStatePersistence, StoredActionState } from './local-action-state'

async function publicationWorkspaceCurrent(
  persistence: ActionStatePersistence,
  projectPath: string,
  pending: PendingActionPublication,
) {
  const expected = pending.workspaceIdentity
  if (!expected) return false
  const current = await readActionWorkspaceIdentity(pending.workspacePath)
  if (
    !current ||
    current.device !== expected.device ||
    current.inode !== expected.inode ||
    current.birthtime !== expected.birthtime
  )
    return false
  const resource = await persistence.readWorkspace(projectPath, pending.workspacePath)
  return (resource?.id ?? null) === expected.resourceId && (!resource || resource.ready)
}

export async function recoverActionPublication(
  persistence: ActionStatePersistence,
  projectPath: string,
  stored: StoredActionState,
): Promise<StoredActionState> {
  const pending = stored.state.pending
  if (!pending || !(await publicationWorkspaceCurrent(persistence, projectPath, pending)))
    return stored
  const requireWorkspace = async () => {
    if (!(await publicationWorkspaceCurrent(persistence, projectPath, pending)))
      throw new Error('The publication Workspace changed. Your draft has been kept.')
  }
  try {
    const current = await readActionManifest(pending.workspacePath)
    const targetRevision = actionContentRevision(serializeActionManifest(pending.nextShared))
    if (current.revision !== targetRevision) {
      // Expose both drafts so the editor can resolve conflicts without data loss.
      if (current.revision !== pending.previousSharedRevision) return stored
      await writeActionManifest(
        pending.workspacePath,
        pending.previousSharedRevision,
        pending.nextShared,
        requireWorkspace,
      )
    }
    await requireWorkspace()
  } catch (error) {
    if (!(await publicationWorkspaceCurrent(persistence, projectPath, pending))) return stored
    throw error
  }
  return persistence.write(projectPath, stored.revision, {
    document: pending.nextLocal,
    pending: null,
  })
}
