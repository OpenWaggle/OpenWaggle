import { ConversationId, SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { StreamChunk } from '@tanstack/ai'
import { describe, expect, it } from 'vitest'
import { openaiProvider } from '../providers/openai'
import {
  notifyRunStart,
  notifyStreamChunk,
  notifyToolCallEnd,
  notifyToolCallStart,
} from './lifecycle-hooks'
import type { AgentLifecycleHook, AgentRunContext } from './runtime-types'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function makeContext(): AgentRunContext {
  return {
    runId: 'run-hooks',
    conversation: {
      id: ConversationId('conv-hooks'),
      title: 'Hook test',
      projectPath: '/tmp/project',
      messages: [],
      createdAt: 0,
      updatedAt: 0,
    },
    model: SupportedModelId('gpt-4.1-mini'),
    settings: {
      ...DEFAULT_SETTINGS,
      providers: {
        ...DEFAULT_SETTINGS.providers,
        openai: {
          apiKey: 'test-key',
          enabled: true,
        },
      },
    },
    signal: new AbortController().signal,
    projectPath: '/tmp/project',
    hasProject: true,
    provider: openaiProvider,
    providerConfig: {
      apiKey: 'test-key',
      enabled: true,
    },
  }
}

describe('lifecycle hook dispatch', () => {
  it('does not block stream-chunk hooks', async () => {
    const gate = deferred()
    let completed = false

    const hooks: AgentLifecycleHook[] = [
      {
        id: 'slow-stream-hook',
        onStreamChunk: async () => {
          await gate.promise
          completed = true
        },
      },
    ]

    const result = notifyStreamChunk(hooks, makeContext(), {
      type: 'TEXT_MESSAGE_CONTENT',
      timestamp: Date.now(),
      delta: 'hello',
    } as StreamChunk)

    expect(result).toBeUndefined()
    expect(completed).toBe(false)

    gate.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(completed).toBe(true)
  })

  it('awaits critical run-start hooks', async () => {
    const gate = deferred()
    let started = false

    const hooks: AgentLifecycleHook[] = [
      {
        id: 'slow-start-hook',
        onRunStart: async () => {
          await gate.promise
          started = true
        },
      },
    ]

    let settled = false
    const promise = notifyRunStart(hooks, makeContext()).then(() => {
      settled = true
    })

    await Promise.resolve()
    expect(settled).toBe(false)

    gate.resolve()
    await promise

    expect(started).toBe(true)
    expect(settled).toBe(true)
  })

  it('does not block tool lifecycle hooks', () => {
    const hooks: AgentLifecycleHook[] = [
      {
        id: 'tool-events',
        onToolCallStart: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1))
        },
        onToolCallEnd: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1))
        },
      },
    ]

    const context = makeContext()

    expect(
      notifyToolCallStart(hooks, context, {
        toolCallId: 'tool-1',
        toolName: 'readFile',
        startedAt: Date.now(),
      }),
    ).toBeUndefined()

    expect(
      notifyToolCallEnd(hooks, context, {
        toolCallId: 'tool-1',
        toolName: 'readFile',
        args: {},
        durationMs: 3,
        isError: false,
        completionState: 'execution-complete',
      }),
    ).toBeUndefined()
  })
})
