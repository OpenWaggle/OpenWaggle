import type { AgentPromptFragment, AgentRunContext } from './runtime-types'

export interface SystemPromptBuildResult {
  readonly prompt: string
  readonly fragmentIds: readonly string[]
}

export function buildSystemPrompt(
  context: AgentRunContext,
  fragments: readonly AgentPromptFragment[],
): SystemPromptBuildResult {
  const orderedFragments = [...fragments].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  )

  const sections: string[] = []
  const fragmentIds: string[] = []

  for (const fragment of orderedFragments) {
    const section = fragment.build(context)?.trim()
    if (!section) continue
    sections.push(section)
    fragmentIds.push(fragment.id)
  }

  if (sections.length === 0) {
    return {
      prompt: 'You are OpenWaggle, an expert coding assistant.',
      fragmentIds,
    }
  }

  return {
    prompt: sections.join('\n\n'),
    fragmentIds,
  }
}
