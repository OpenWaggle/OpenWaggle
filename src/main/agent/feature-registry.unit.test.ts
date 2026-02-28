import { ConversationId, SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import { openaiProvider } from '../providers/openai'
import {
  getActiveAgentFeatures,
  getAgentFeatureFlags,
  getFeatureLifecycleHooks,
  getFeaturePromptFragments,
} from './feature-registry'
import type { AgentRunContext } from './runtime-types'

function makeContext(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
  return {
    runId: 'run-feature-test',
    conversation: {
      id: ConversationId('conv-feature-test'),
      title: 'Feature registry test',
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

describe('getAgentFeatureFlags', () => {
  it('returns an object with all default flags set to true', () => {
    const flags = getAgentFeatureFlags()

    expect(flags['standards.prompt']).toBe(true)
    expect(flags['core.prompt']).toBe(true)
    expect(flags['core.tools']).toBe(true)
    expect(flags['core.execution-mode']).toBe(true)
    expect(flags['core.observability']).toBe(true)
    expect(flags['browser.tools']).toBe(true)
  })
})

describe('getActiveAgentFeatures', () => {
  it('returns all features when context.hasProject is true', () => {
    const context = makeContext({ hasProject: true })
    const features = getActiveAgentFeatures(context)

    const ids = features.map((f) => f.id)
    expect(ids).toContain('standards.prompt')
    expect(ids).toContain('core.prompt')
    expect(ids).toContain('core.tools')
    expect(ids).toContain('core.execution-mode')
    expect(ids).toContain('core.observability')
    expect(ids).toContain('browser.tools')
    expect(features.length).toBe(6)
  })

  it('excludes core.tools when context.hasProject is false', () => {
    const context = makeContext({ hasProject: false })
    const features = getActiveAgentFeatures(context)

    const ids = features.map((f) => f.id)
    expect(ids).not.toContain('core.tools')
    expect(ids).toContain('standards.prompt')
    expect(ids).toContain('core.prompt')
    expect(ids).toContain('core.execution-mode')
    expect(ids).toContain('core.observability')
    expect(ids).toContain('browser.tools')
    expect(features.length).toBe(5)
  })
})

describe('getFeaturePromptFragments', () => {
  it('returns prompt fragments from active features', () => {
    const context = makeContext()
    const features = getActiveAgentFeatures(context)
    const fragments = getFeaturePromptFragments(context, features)

    expect(fragments.length).toBeGreaterThan(0)
    const ids = fragments.map((f) => f.id)
    // core.prompt contributes: core.behavior, core.runtime-model, core.project-context
    expect(ids).toContain('core.behavior')
    expect(ids).toContain('core.runtime-model')
    expect(ids).toContain('core.project-context')
    // core.execution-mode contributes: core.execution-mode
    expect(ids).toContain('core.execution-mode')
    // browser.tools contributes: browser.capabilities
    expect(ids).toContain('browser.capabilities')
  })

  it('returns empty array for features with no getPromptFragments', () => {
    const context = makeContext()
    const featureWithNoFragments = [{ id: 'empty-feature' }]
    const fragments = getFeaturePromptFragments(context, featureWithNoFragments)

    expect(fragments).toEqual([])
  })

  it('each feature getPromptFragments returns non-empty arrays', () => {
    const context = makeContext()
    const features = getActiveAgentFeatures(context)

    for (const feature of features) {
      if (feature.getPromptFragments) {
        const fragments = feature.getPromptFragments(context)
        expect(fragments.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('getFeatureLifecycleHooks', () => {
  it('returns lifecycle hooks from features', () => {
    const context = makeContext()
    const features = getActiveAgentFeatures(context)
    const hooks = getFeatureLifecycleHooks(context, features)

    expect(hooks.length).toBeGreaterThan(0)
    const ids = hooks.map((h) => h.id)
    expect(ids).toContain('core.observability.logger')
  })

  it('returns empty array for features with no getLifecycleHooks', () => {
    const context = makeContext()
    const featureWithNoHooks = [{ id: 'empty-feature' }]
    const hooks = getFeatureLifecycleHooks(context, featureWithNoHooks)

    expect(hooks).toEqual([])
  })
})
