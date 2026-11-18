import type { WorkspaceEditorConfigPolicy } from '@shared/types/workspace-files'

export function applyEditorConfigContentPolicy(
  content: string,
  policy: WorkspaceEditorConfigPolicy | undefined,
) {
  let nextContent = content
  if (policy?.trimTrailingWhitespace) {
    nextContent = nextContent.replace(/[\t ]+(?=\n|$)/gu, '')
  }
  if (policy?.finalNewline && !nextContent.endsWith('\n')) {
    nextContent = `${nextContent}\n`
  }
  return nextContent
}
