import type { Message } from '@shared/types/agent'
import type { ConversationId, SubAgentId } from '@shared/types/brand'
import type { SubAgentResult } from '@shared/types/sub-agent'
import { createLogger } from '../logger'

const logger = createLogger('sub-agent-registry')

export interface SubAgentEntry {
  readonly agentId: SubAgentId
  readonly name: string
  readonly agentType: string
  readonly conversationId: ConversationId
  readonly parentConversationId: ConversationId
  readonly teamId?: string
  readonly status: 'running' | 'idle' | 'completed' | 'failed' | 'shutdown'
  readonly startedAt: number
  readonly completedAt?: number
  readonly result?: SubAgentResult
  readonly conversationSnapshot?: readonly Message[]
}

const agents = new Map<SubAgentId, SubAgentEntry>()

export function registerSubAgent(entry: SubAgentEntry): void {
  agents.set(entry.agentId, entry)
  logger.info('Sub-agent registered', {
    agentId: entry.agentId,
    name: entry.name,
    type: entry.agentType,
  })
}

export function getSubAgent(agentId: SubAgentId): SubAgentEntry | undefined {
  return agents.get(agentId)
}

export function updateSubAgent(
  agentId: SubAgentId,
  update: Partial<Omit<SubAgentEntry, 'agentId'>>,
): void {
  const existing = agents.get(agentId)
  if (!existing) {
    logger.warn('Attempted to update unknown sub-agent', { agentId })
    return
  }
  agents.set(agentId, { ...existing, ...update })
}

export function storeConversationSnapshot(agentId: SubAgentId, messages: readonly Message[]): void {
  const existing = agents.get(agentId)
  if (!existing) return
  agents.set(agentId, { ...existing, conversationSnapshot: messages })
}

export function getConversationSnapshot(agentId: SubAgentId): readonly Message[] | undefined {
  return agents.get(agentId)?.conversationSnapshot
}

export function listSubAgentsByTeam(teamId: string): readonly SubAgentEntry[] {
  const result: SubAgentEntry[] = []
  for (const entry of agents.values()) {
    if (entry.teamId === teamId) {
      result.push(entry)
    }
  }
  return result
}

export function listActiveSubAgents(): readonly SubAgentEntry[] {
  const result: SubAgentEntry[] = []
  for (const entry of agents.values()) {
    if (entry.status === 'running' || entry.status === 'idle') {
      result.push(entry)
    }
  }
  return result
}

export function countBackgroundAgents(): number {
  let count = 0
  for (const entry of agents.values()) {
    if (entry.status === 'running') {
      count++
    }
  }
  return count
}

export function clearSubAgentRegistry(): void {
  agents.clear()
}
