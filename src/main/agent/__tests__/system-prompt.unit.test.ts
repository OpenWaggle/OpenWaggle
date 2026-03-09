import { ConversationId, SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import { openaiProvider } from '../../providers/openai'
import type { AgentRunContext } from '../runtime-types'
import {
  coreBehaviorPromptFragment,
  executionModePromptFragment,
  projectContextPromptFragment,
  runtimeModelPromptFragment,
} from '../system-prompt'

function makeContext(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
  return {
    runId: 'run-system-prompt-test',
    conversation: {
      id: ConversationId('conv-system-prompt-test'),
      title: 'System prompt test',
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
    ...overrides,
  }
}

describe('coreBehaviorPromptFragment', () => {
  it('build returns a string containing "OpenWaggle"', () => {
    const context = makeContext()
    const result = coreBehaviorPromptFragment.build(context)

    expect(result).toContain('OpenWaggle')
  })
})

describe('runtimeModelPromptFragment', () => {
  it('build includes provider name and model', () => {
    const context = makeContext()
    const result = runtimeModelPromptFragment.build(context)

    expect(result).toContain(context.provider.displayName)
    expect(result).toContain(context.model)
  })
})

describe('projectContextPromptFragment', () => {
  it('build includes projectPath when hasProject is true', () => {
    const context = makeContext({ hasProject: true, projectPath: '/tmp/my-project' })
    const result = projectContextPromptFragment.build(context)

    expect(result).toContain('/tmp/my-project')
    expect(result).toContain('project is located at')
  })

  it('build mentions "No project" when hasProject is false', () => {
    const context = makeContext({ hasProject: false })
    const result = projectContextPromptFragment.build(context)

    expect(result).toContain('No project')
  })
})

describe('executionModePromptFragment', () => {
  it('build returns default-permissions message for executionMode default-permissions', () => {
    const context = makeContext({
      settings: { ...DEFAULT_SETTINGS, executionMode: 'default-permissions' },
    })
    const result = executionModePromptFragment.build(context)

    expect(result).toContain('Default permissions')
    expect(result).toContain('require explicit user approval')
  })

  it('build returns full-access message for executionMode full-access', () => {
    const context = makeContext({
      settings: { ...DEFAULT_SETTINGS, executionMode: 'full-access' },
    })
    const result = executionModePromptFragment.build(context)

    expect(result).toContain('Full access')
  })
})
