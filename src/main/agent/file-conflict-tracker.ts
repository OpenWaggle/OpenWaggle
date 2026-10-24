import type { WaggleAgentSlot, WaggleFileConflictWarning } from '@shared/types/waggle'

/**
 * Tracks which agent last modified each file path during a Waggle collaboration.
 * Returns conflict warnings when a different agent edits a file previously modified by another.
 */
export class FileConflictTracker {
  private readonly lastModifiedBy = new Map<string, number>()

  recordModification(
    filePath: string,
    agentIndex: number,
    agents: readonly [WaggleAgentSlot, WaggleAgentSlot],
    turnNumber: number,
  ): WaggleFileConflictWarning | null {
    const previousAgentIndex = this.lastModifiedBy.get(filePath)
    this.lastModifiedBy.set(filePath, agentIndex)
    if (previousAgentIndex === undefined || previousAgentIndex === agentIndex) return null

    return {
      path: filePath,
      previousAgent: agents[previousAgentIndex]?.label ?? `Agent ${String(previousAgentIndex)}`,
      currentAgent: agents[agentIndex]?.label ?? `Agent ${String(agentIndex)}`,
      turnNumber,
    }
  }
}
