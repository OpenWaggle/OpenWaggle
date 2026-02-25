import type {
  AgentSlot,
  FileConflictWarning,
  FileModificationRecord,
} from '@shared/types/multi-agent'

/**
 * Tracks which agent last modified each file path during a multi-agent collaboration.
 * Returns conflict warnings when a different agent edits a file previously modified by another.
 */
export class FileConflictTracker {
  private readonly modifications = new Map<string, FileModificationRecord>()

  recordModification(
    filePath: string,
    agentIndex: number,
    agents: readonly [AgentSlot, AgentSlot],
    turnNumber: number,
  ): FileConflictWarning | null {
    const existing = this.modifications.get(filePath)

    if (existing && existing.lastModifiedBy !== agentIndex) {
      const warning: FileConflictWarning = {
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

  getModifications(): ReadonlyMap<string, FileModificationRecord> {
    return this.modifications
  }

  reset(): void {
    this.modifications.clear()
  }
}
