import { ConversationId, SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import { openaiProvider } from '../../providers/openai'
import { builtInTools } from '../../tools/built-in-tools'
import {
  getActiveAgentFeatures,
  getFeatureLifecycleHooks,
  getFeaturePromptFragments,
} from '../feature-registry'
import type { AgentRunContext } from '../runtime-types'

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
    // mcp.tools is conditionally enabled (only when MCP servers are connected)
    expect(ids).not.toContain('mcp.tools')
    expect(features.length).toBe(5)
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
    // mcp.tools excluded — no connected servers in test environment
    expect(ids).not.toContain('mcp.tools')
    expect(features.length).toBe(4)
  })

  it('enables trusted tool feature when writeFile is trusted in project config', () => {
    const context = makeContext({
      toolApprovals: {
        tools: {
          writeFile: { trusted: true },
        },
      },
    })
    const features = getActiveAgentFeatures(context)

    const ids = features.map((f) => f.id)
    expect(ids).toContain('core.tool-trust')
  })
})

describe('trusted tool filtering', () => {
  it('strips writeFile and editFile approvals when trust is enabled', () => {
    const context = makeContext({
      toolApprovals: {
        tools: {
          writeFile: { trusted: true },
          editFile: { trusted: true },
        },
      },
    })
    const features = getActiveAgentFeatures(context)

    let filteredTools = [...builtInTools]
    for (const feature of features) {
      if (feature.filterTools) {
        filteredTools = [...feature.filterTools(filteredTools, context)]
      }
    }

    const writeFile = filteredTools.find((tool) => tool.name === 'writeFile')
    const editFile = filteredTools.find((tool) => tool.name === 'editFile')
    expect(writeFile?.needsApproval).toBe(false)
    expect(editFile?.needsApproval).toBe(false)
  })

  it('strips all approvals in full-access mode', () => {
    const context = makeContext({
      settings: { ...DEFAULT_SETTINGS, executionMode: 'full-access' },
    })
    const features = getActiveAgentFeatures(context)

    let filteredTools = [...builtInTools]
    for (const feature of features) {
      if (feature.filterTools) {
        filteredTools = [...feature.filterTools(filteredTools, context)]
      }
    }

    const approvalTools = filteredTools.filter((tool) => tool.needsApproval)
    expect(approvalTools).toHaveLength(0)
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
    // mcp.tools is excluded (no connected servers), so no mcp.capabilities fragment
    expect(ids).not.toContain('mcp.capabilities')
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
