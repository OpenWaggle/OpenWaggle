import type { ConversationSummary } from '@shared/types/conversation'
import { choose } from '@shared/utils/decision'
import { projectName } from '@/lib/format'

export type SortMode = 'recent' | 'oldest' | 'name' | 'threads'

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

export function sortConversationGroups(groups: ProjectGroup[], mode: SortMode): ProjectGroup[] {
  const sorted = [...groups]
  choose(mode)
    .case('recent', () => {
      const maxUpdated = new Map<ProjectGroup, number>()
      for (const g of sorted) {
        let max = -Infinity
        for (const c of g.conversations) if (c.updatedAt > max) max = c.updatedAt
        maxUpdated.set(g, max)
      }
      sorted.sort((a, b) => (maxUpdated.get(b) ?? 0) - (maxUpdated.get(a) ?? 0))
    })
    .case('oldest', () => {
      const minCreated = new Map<ProjectGroup, number>()
      for (const g of sorted) {
        let min = Infinity
        for (const c of g.conversations) if (c.createdAt < min) min = c.createdAt
        minCreated.set(g, min)
      }
      sorted.sort((a, b) => (minCreated.get(a) ?? 0) - (minCreated.get(b) ?? 0))
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
