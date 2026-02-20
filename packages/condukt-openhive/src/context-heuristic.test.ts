import { expect, test } from 'vitest'

import { resolveChildContextHeuristic } from './context-heuristic'

test('includes conversation summary for context-heavy task kinds', () => {
  const decision = resolveChildContextHeuristic({ taskKind: 'analysis' })

  expect(decision.includeConversationSummary).toBe(true)
  expect(decision.maxContextTokens).toBe(1500)
})

test('respects explicit context and custom token cap', () => {
  const decision = resolveChildContextHeuristic({
    taskKind: 'general',
    needsConversationContext: true,
    maxContextTokens: 200,
  })

  expect(decision.includeConversationSummary).toBe(true)
  expect(decision.maxContextTokens).toBe(200)
})
