import { applyEditorConfigContentPolicy } from '../lib/editorconfig-policy'
import type { WorkspaceSaveQueueContext } from './workspace-save-queue'

export function applyWorkspaceContentPolicyForSave(
  context: WorkspaceSaveQueueContext,
  capturedContent: string,
) {
  const content = applyEditorConfigContentPolicy(
    capturedContent,
    context.file.fidelity.editorConfigPolicy,
  )
  const applied = content !== capturedContent
  if (!applied) return { content, applied }

  context.latestContent.current = content
  context.latestSnapshot.current = null
  if (context.mounted.current) {
    context.setContent(content)
    context.setEditorRevision(
      `${context.revision.current}:editorconfig:${String(context.persistedVersion.current + 1)}`,
    )
  }
  return { content, applied }
}
