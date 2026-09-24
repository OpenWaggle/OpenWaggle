import type { PendingActionPublication } from '../../domain/project-action-catalog'
import { readActionWorkspaceIdentity } from './action-manifest-file'
import { actionPublicationCurrent, writeActionManifest } from './action-publication-files'
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
  if (
    !pending?.publication ||
    !(await publicationWorkspaceCurrent(persistence, projectPath, pending)) ||
    !(await actionPublicationCurrent(pending.workspacePath, pending.publication))
  )
    return stored
  const requireWorkspace = async () => {
    if (!(await publicationWorkspaceCurrent(persistence, projectPath, pending)))
      throw new Error('The publication Workspace changed. Your draft has been kept.')
  }
  try {
    const published = await writeActionManifest(
      pending.workspacePath,
      pending.previousSharedRevision,
      pending.nextShared,
      pending.publication,
      requireWorkspace,
    )
    // Expose both drafts and the retained inode when another writer wins publication.
    if (!published) return stored
    await requireWorkspace()
  } catch (error) {
    if (
      !(await publicationWorkspaceCurrent(persistence, projectPath, pending)) ||
      !(await actionPublicationCurrent(pending.workspacePath, pending.publication))
    )
      return stored
    throw error
  }
  return persistence.write(projectPath, stored.revision, {
    document: pending.nextLocal,
    pending: null,
  })
}
