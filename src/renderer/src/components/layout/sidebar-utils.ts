import type { ConversationSummary } from '@shared/types/conversation'
import { choose } from '@shared/utils/decision'
import { projectName } from '@/lib/format'

export type SortMode = 'recent' | 'oldest' | 'name' | 'threads'

export interface ProjectGroup {
  path: string | null
  displayName: string
  conversations: ConversationSummary[]
}

export function groupConversationsByProject(conversations: ConversationSummary[]): ProjectGroup[] {
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
    result.push({
      path: key === '__none__' ? null : key,
      displayName: key === '__none__' ? 'No project' : projectName(key),
      conversations: convs,
    })
  }

  return result
}

export function sortConversationGroups(groups: ProjectGroup[], mode: SortMode): ProjectGroup[] {
  const sorted = [...groups]
  choose(mode)
    .case('recent', () => {
      sorted.sort((a, b) => {
        const aMax = Math.max(...a.conversations.map((c) => c.updatedAt))
        const bMax = Math.max(...b.conversations.map((c) => c.updatedAt))
        return bMax - aMax
      })
    })
    .case('oldest', () => {
      sorted.sort((a, b) => {
        const aMin = Math.min(...a.conversations.map((c) => c.createdAt))
        const bMin = Math.min(...b.conversations.map((c) => c.createdAt))
        return aMin - bMin
      })
    })
    .case('name', () => {
      sorted.sort((a, b) => a.displayName.localeCompare(b.displayName))
    })
    .case('threads', () => {
      sorted.sort((a, b) => b.conversations.length - a.conversations.length)
    })
    .assertComplete()
  return sorted
}
