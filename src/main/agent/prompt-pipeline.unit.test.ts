import { ConversationId } from '@shared/types/brand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import { openaiProvider } from '../providers/openai'
import { buildSystemPrompt } from './prompt-pipeline'
import type { AgentPromptFragment, AgentRunContext } from './runtime-types'

function makeContext(overrides?: { executionMode?: Settings['executionMode'] }): AgentRunContext {
  const executionMode = overrides?.executionMode ?? 'full-access'

  return {
    runId: 'run-prompt',
    conversation: {
      id: ConversationId('conv-prompt'),
      title: 'Prompt test',
      projectPath: '/tmp/project',
      messages: [],
      createdAt: 0,
      updatedAt: 0,
    },
    model: 'gpt-4.1-mini',
    settings: {
      ...DEFAULT_SETTINGS,
      executionMode,
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

describe('buildSystemPrompt', () => {
  it('sorts fragments by order then id and returns applied fragment IDs', () => {
    const context = makeContext()
    const fragments: AgentPromptFragment[] = [
      {
        id: 'z-third',
        order: 30,
        build: () => 'third',
      },
      {
        id: 'a-first',
        order: 10,
        build: () => 'first',
      },
      {
        id: 'b-second',
        order: 10,
        build: () => 'second',
      },
    ]

    const result = buildSystemPrompt(context, fragments)

    expect(result.prompt).toBe('first\n\nsecond\n\nthird')
    expect(result.fragmentIds).toEqual(['a-first', 'b-second', 'z-third'])
  })

  it('omits empty fragment output', () => {
    const context = makeContext()
    const fragments: AgentPromptFragment[] = [
      {
        id: 'core',
        order: 10,
        build: () => 'core prompt',
      },
      {
        id: 'empty',
        order: 20,
        build: () => '   ',
      },
      {
        id: 'null',
        order: 30,
        build: () => null,
      },
    ]

    const result = buildSystemPrompt(context, fragments)

    expect(result.prompt).toBe('core prompt')
    expect(result.fragmentIds).toEqual(['core'])
  })
})
