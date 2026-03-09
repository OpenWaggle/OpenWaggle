import { ConversationId, SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { describe, expect, it, vi } from 'vitest'
import { openaiProvider } from '../../providers/openai'
import { notifyRunComplete, notifyRunError, notifyStreamChunk } from '../lifecycle-hooks'
import type { AgentLifecycleHook, AgentRunContext, AgentRunSummary } from '../runtime-types'

function makeContext(): AgentRunContext {
  return {
    runId: 'run-extra',
    conversation: {
      id: ConversationId('conv-extra'),
      title: 'Extra hook tests',
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
        openai: { apiKey: 'test-key', enabled: true },
      },
    },
    signal: new AbortController().signal,
    projectPath: '/tmp/project',
    hasProject: true,
    provider: openaiProvider,
    providerConfig: { apiKey: 'test-key', enabled: true },
  }
}

describe('lifecycle hook error handling and missing events', () => {
  it('notifyRunError invokes onRunError hooks', async () => {
    const onRunError = vi.fn()
    const hooks: AgentLifecycleHook[] = [{ id: 'err-hook', onRunError }]

    const err = new Error('something broke')
    await notifyRunError(hooks, makeContext(), err)

    expect(onRunError).toHaveBeenCalledTimes(1)
    expect(onRunError).toHaveBeenCalledWith(expect.anything(), err)
  })

  it('notifyRunComplete invokes onRunComplete hooks', async () => {
    const onRunComplete = vi.fn()
    const hooks: AgentLifecycleHook[] = [{ id: 'complete-hook', onRunComplete }]

    const summary: AgentRunSummary = {
      promptFragmentIds: ['core.behavior'],
      stageDurationsMs: {},
      toolCalls: 5,
      toolErrors: 0,
    }
    await notifyRunComplete(hooks, makeContext(), summary)

    expect(onRunComplete).toHaveBeenCalledTimes(1)
    expect(onRunComplete).toHaveBeenCalledWith(expect.anything(), summary)
  })

  it('catches errors thrown by hooks in runHookEvent', async () => {
    const hooks: AgentLifecycleHook[] = [
      {
        id: 'throwing-hook',
        onRunError: () => {
          throw new Error('hook exploded')
        },
      },
    ]

    // Should not throw — errors are caught and logged
    await expect(
      notifyRunError(hooks, makeContext(), new Error('original')),
    ).resolves.toBeUndefined()
  })

  it('catches errors thrown by hooks in runHookEventDetached', async () => {
    const hooks: AgentLifecycleHook[] = [
      {
        id: 'throwing-stream-hook',
        onStreamChunk: () => {
          throw new Error('stream hook exploded')
        },
      },
    ]

    // Should not throw — errors are caught internally
    expect(() =>
      notifyStreamChunk(hooks, makeContext(), {
        type: 'TEXT_MESSAGE_CONTENT',
        timestamp: Date.now(),
        delta: 'hi',
      } as import('@tanstack/ai').StreamChunk),
    ).not.toThrow()

    // Allow the detached promise to settle
    await new Promise((r) => setTimeout(r, 10))
  })
})
