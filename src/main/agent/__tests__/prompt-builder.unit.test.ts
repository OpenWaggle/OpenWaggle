import { describe, expect, it, vi } from 'vitest'

vi.mock('../feature-registry', () => ({
  getActiveAgentFeatures: vi.fn(() => []),
  getFeatureLifecycleHooks: vi.fn(() => []),
  getFeaturePromptFragments: vi.fn(() => []),
}))

vi.mock('../prompt-pipeline', () => ({
  buildSystemPrompt: vi.fn((_ctx: unknown, _fragments: unknown) => ({
    prompt: 'You are a test assistant.',
    fragmentIds: ['frag-1'],
  })),
}))

vi.mock('../../tools/registry', () => ({
  getServerTools: vi.fn(() => [
    { name: 'readFile', needsApproval: false },
    { name: 'writeFile', needsApproval: true },
  ]),
}))

vi.mock('../../tools/without-approval', () => ({
  withoutApproval: vi.fn((tools: { name: string; needsApproval: boolean }[]) =>
    tools.map((t) => ({ ...t, needsApproval: false })),
  ),
}))

import { ConversationId, SupportedModelId } from '@shared/types/brand'
import { getActiveAgentFeatures, getFeaturePromptFragments } from '../feature-registry'
import { buildAgentPrompt } from '../prompt-builder'
import type { AgentRunContext } from '../runtime-types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunContext(): AgentRunContext {
  return {
    runId: 'test-run',
    conversation: {
      id: ConversationId('conv-1'),
      title: 'Test',
      messages: [],
      projectPath: '/tmp',
      createdAt: 0,
      updatedAt: 0,
    },
    model: SupportedModelId('test-model'),
    settings: { executionMode: 'autonomous' },
    signal: new AbortController().signal,
    projectPath: '/tmp',
    hasProject: true,
    provider: { id: 'test' },
    providerConfig: { apiKey: 'k' },
  } as unknown as AgentRunContext
}

// ---------------------------------------------------------------------------
// buildAgentPrompt
// ---------------------------------------------------------------------------

describe('buildAgentPrompt', () => {
  it('returns composed system prompt and resolved tools', () => {
    const result = buildAgentPrompt(makeRunContext(), false)

    expect(result.systemPrompt).toBe('You are a test assistant.')
    expect(result.promptFragmentIds).toEqual(['frag-1'])
    expect(result.tools).toHaveLength(2)
    expect(getActiveAgentFeatures).toHaveBeenCalled()
    expect(getFeaturePromptFragments).toHaveBeenCalled()
  })

  it('strips approval when skipApproval is true', () => {
    const result = buildAgentPrompt(makeRunContext(), true)

    // withoutApproval mock strips needsApproval
    for (const tool of result.tools) {
      expect((tool as { needsApproval: boolean }).needsApproval).toBe(false)
    }
  })

  it('preserves approval flags when skipApproval is false', () => {
    const result = buildAgentPrompt(makeRunContext(), false)

    const approvalFlags = result.tools.map((t) => (t as { needsApproval: boolean }).needsApproval)
    // One false (readFile), one true (writeFile)
    expect(approvalFlags).toContain(false)
    expect(approvalFlags).toContain(true)
  })
})
