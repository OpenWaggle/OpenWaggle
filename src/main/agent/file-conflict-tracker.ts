import type {
  WaggleAgentSlot,
  WaggleFileConflictWarning,
  WaggleFileModificationRecord,
} from '@shared/types/waggle'

/**
 * Tracks which agent last modified each file path during a Waggle collaboration.
 * Returns conflict warnings when a different agent edits a file previously modified by another.
 */
export class FileConflictTracker {
  private readonly modifications = new Map<string, WaggleFileModificationRecord>()

  recordModification(
    filePath: string,
    agentIndex: number,
    agents: readonly [WaggleAgentSlot, WaggleAgentSlot],
    turnNumber: number,
  ): WaggleFileConflictWarning | null {
    const existing = this.modifications.get(filePath)

    if (existing && existing.lastModifiedBy !== agentIndex) {
      const warning: WaggleFileConflictWarning = {
        path: filePath,
        previousAgent:
          agents[existing.lastModifiedBy]?.label ?? `Agent ${String(existing.lastModifiedBy)}`,
        currentAgent: agents[agentIndex]?.label ?? `Agent ${String(agentIndex)}`,
        turnNumber,
      }

      this.modifications.set(filePath, {
        path: filePath,
        lastModifiedBy: agentIndex,
        modifiedAt: Date.now(),
        modificationCount: existing.modificationCount + 1,
      })

      return warning
    }

    this.modifications.set(filePath, {
      path: filePath,
      lastModifiedBy: agentIndex,
      modifiedAt: Date.now(),
      modificationCount: (existing?.modificationCount ?? 0) + 1,
    })

    return null
  }

  getModifications(): ReadonlyMap<string, WaggleFileModificationRecord> {
    return this.modifications
  }

  reset(): void {
    this.modifications.clear()
  }
}
