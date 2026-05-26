import { SupportedModelId } from '@shared/types/brand'
import type {
  WaggleConfig,
  WaggleConsensusCheckResult,
  WaggleFileConflictWarning,
  WaggleMessageMetadata,
} from '@shared/types/waggle'

export const ARCHITECT_MODEL = SupportedModelId('claude-sonnet-4-20250514')
export const REVIEWER_MODEL = SupportedModelId('gpt-4o')

export function itemAt<TItem>(items: readonly TItem[], index: number): TItem {
  const item = items[index]
  if (!item) {
    throw new Error(`Expected item at index ${String(index)}`)
  }
  return item
}

export function makeConfig() {
  return {
    mode: 'sequential',
    agents: [
      {
        label: 'Architect',
        model: ARCHITECT_MODEL,
        roleDescription: 'System designer',
        color: 'blue',
      },
      {
        label: 'Reviewer',
        model: REVIEWER_MODEL,
        roleDescription: 'Code reviewer',
        color: 'amber',
      },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: 10 },
  } satisfies WaggleConfig
}

export function makeConsensusResult(reached: boolean) {
  return {
    reached,
    confidence: reached ? 0.85 : 0.3,
    reason: reached ? 'Agents agree on the approach' : 'Still debating',
    signals: [
      { type: 'explicit-agreement', confidence: 0.9, reason: 'Both agents confirmed approach' },
    ],
  } satisfies WaggleConsensusCheckResult
}

export function makeFileConflict(path: string) {
  return {
    path,
    previousAgent: 'Architect',
    currentAgent: 'Reviewer',
    turnNumber: 2,
  } satisfies WaggleFileConflictWarning
}

export function makeMessageMetadata(overrides: Partial<WaggleMessageMetadata> = {}) {
  return {
    agentIndex: 0,
    agentLabel: 'Architect',
    agentColor: 'blue',
    turnNumber: 1,
    ...overrides,
  } satisfies WaggleMessageMetadata
}
