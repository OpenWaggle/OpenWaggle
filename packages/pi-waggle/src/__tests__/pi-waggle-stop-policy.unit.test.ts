import type { AgentEndEvent } from '@mariozechner/pi-coding-agent'
import type { WaggleConfig } from '@openwaggle/waggle-core'
import { describe, expect, it } from 'vitest'
import {
  createPiWaggleStopPolicyState,
  evaluatePiWaggleStopPolicy,
  summarizePiWaggleTurnMessages,
} from '../stop-policy'

const MAX_TURNS = 2

function config(): WaggleConfig {
  return {
    mode: 'sequential',
    agents: [
      {
        label: 'Architect',
        model: 'openai/gpt-5.5',
        roleDescription: 'Designs',
        color: 'blue',
      },
      {
        label: 'Reviewer',
        model: 'anthropic/claude-sonnet-4',
        roleDescription: 'Reviews',
        color: 'amber',
      },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: MAX_TURNS },
  }
}

function assistantMessage(input: {
  readonly text?: string
  readonly stopReason?: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted'
  readonly errorMessage?: string
  readonly toolCallId?: string
  readonly toolCallName?: string
}): AgentEndEvent['messages'][number] {
  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }
  > = []
  if (input.text) content.push({ type: 'text', text: input.text })
  if (input.toolCallId && input.toolCallName) {
    content.push({
      type: 'toolCall',
      id: input.toolCallId,
      name: input.toolCallName,
      arguments: {},
    })
  }

  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'openai',
    model: 'gpt-5.5',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: input.stopReason ?? 'stop',
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    timestamp: Date.now(),
  }
}

function toolResultMessage(toolCallId: string): AgentEndEvent['messages'][number] {
  return {
    role: 'toolResult',
    toolCallId,
    toolName: 'write',
    content: [{ type: 'text', text: 'ok' }],
    isError: false,
    timestamp: Date.now(),
  }
}

describe('pi-waggle stop policy', () => {
  it('stops after two consecutive recoverable errors', () => {
    const waggleConfig = config()
    const first = evaluatePiWaggleStopPolicy({
      config: waggleConfig,
      turnNumber: 0,
      summary: summarizePiWaggleTurnMessages([
        assistantMessage({ stopReason: 'error', errorMessage: 'Provider timeout' }),
      ]),
      state: createPiWaggleStopPolicyState(),
      agentLabel: 'Architect',
    })
    expect(first.continue).toBe(true)

    const second = evaluatePiWaggleStopPolicy({
      config: waggleConfig,
      turnNumber: 1,
      summary: summarizePiWaggleTurnMessages([
        assistantMessage({ stopReason: 'error', errorMessage: 'Provider timeout' }),
      ]),
      state: first.state,
      agentLabel: 'Reviewer',
    })
    expect(second.continue).toBe(false)
    expect(second.stop).toEqual({
      classification: 'stopped',
      reason: 'Provider timeout',
    })
  })

  it('stops immediately when an assistant turn is aborted', () => {
    const decision = evaluatePiWaggleStopPolicy({
      config: config(),
      turnNumber: 0,
      summary: summarizePiWaggleTurnMessages([assistantMessage({ stopReason: 'aborted' })]),
      state: createPiWaggleStopPolicyState(),
      agentLabel: 'Architect',
    })

    expect(decision.continue).toBe(false)
    expect(decision.turnSucceeded).toBe(false)
    expect(decision.stop).toEqual({
      classification: 'stopped',
      reason: 'Waggle stopped because the assistant turn was aborted.',
    })
  })

  it('stops immediately when unresolved tool calls remain', () => {
    const decision = evaluatePiWaggleStopPolicy({
      config: config(),
      turnNumber: 0,
      summary: summarizePiWaggleTurnMessages([
        assistantMessage({ text: 'Working on it', toolCallId: 'tool-1', toolCallName: 'write' }),
      ]),
      state: createPiWaggleStopPolicyState(),
      agentLabel: 'Architect',
    })

    expect(decision.continue).toBe(false)
    expect(decision.stop?.classification).toBe('stopped')
    expect(decision.stop?.reason).toContain('unresolved tool calls')
  })

  it('continues when tool calls are resolved by tool result messages', () => {
    const decision = evaluatePiWaggleStopPolicy({
      config: config(),
      turnNumber: 0,
      summary: summarizePiWaggleTurnMessages([
        assistantMessage({ text: 'Writing file', toolCallId: 'tool-1', toolCallName: 'write' }),
        toolResultMessage('tool-1'),
      ]),
      state: createPiWaggleStopPolicyState(),
      agentLabel: 'Architect',
    })

    expect(decision.continue).toBe(true)
    expect(decision.turnSucceeded).toBe(true)
  })

  it('completes when consensus is reached', () => {
    const waggleConfig = config()
    const first = evaluatePiWaggleStopPolicy({
      config: waggleConfig,
      turnNumber: 0,
      summary: summarizePiWaggleTurnMessages([
        assistantMessage({
          text: 'I propose migrating orchestration into the package and keeping runtime state Pi-native.',
        }),
      ]),
      state: createPiWaggleStopPolicyState(),
      agentLabel: 'Architect',
    })
    expect(first.continue).toBe(true)

    const second = evaluatePiWaggleStopPolicy({
      config: waggleConfig,
      turnNumber: 1,
      summary: summarizePiWaggleTurnMessages([
        assistantMessage({
          text: 'I agree, that plan is correct and we are aligned.',
        }),
      ]),
      state: first.state,
      agentLabel: 'Reviewer',
    })

    expect(second.continue).toBe(false)
    expect(second.stop?.classification).toBe('complete')
    expect(second.stop?.reason).toContain('Consensus reached')
  })
})
