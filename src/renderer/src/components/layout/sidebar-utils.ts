import type { ConversationSummary } from '@shared/types/conversation'
import { projectName } from '@/lib/format'

export interface ProjectGroup {
  path: string | null
  displayName: string
  conversations: ConversationSummary[]
}

export function groupConversationsByProject(
  conversations: ConversationSummary[],
  displayNameOverrides: Record<string, string> = {},
): ProjectGroup[] {
  const groups = new Map<string, ConversationSummary[]>()

  for (const conv of conversations) {
    const key = conv.projectPath ?? '__none__'
    const existing = groups.get(key)
    if (existing) {
      existing.push(conv)
    } else {
      groups.set(key, [conv])
    }
  }

  const result: ProjectGroup[] = []
  for (const [key, convs] of groups) {
    const path = key === '__none__' ? null : key
    const displayName =
      key === '__none__' ? 'No project' : (displayNameOverrides[key] ?? projectName(key))
    result.push({ path, displayName, conversations: convs })
  }

  return result
}
