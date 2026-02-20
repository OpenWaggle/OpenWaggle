import { ConversationId } from '@shared/types/brand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import type { ServerTool } from '@tanstack/ai'
import { describe, expect, it } from 'vitest'
import { getActiveAgentFeatures } from '../agent/feature-registry'
import type { AgentFeature, AgentRunContext } from '../agent/runtime-types'
import { openaiProvider } from '../providers/openai'
import { getServerTools } from './registry'

function makeContext(overrides?: {
  executionMode?: Settings['executionMode']
  hasProject?: boolean
}): AgentRunContext {
  const executionMode = overrides?.executionMode ?? 'full-access'
  const hasProject = overrides?.hasProject ?? true

  return {
    runId: 'run-tools',
    conversation: {
      id: ConversationId('conv-tools'),
      title: 'Tool test',
      projectPath: hasProject ? '/tmp/project' : null,
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
    projectPath: hasProject ? '/tmp/project' : process.cwd(),
    hasProject,
    provider: openaiProvider,
    providerConfig: {
      apiKey: 'test-key',
      enabled: true,
    },
  }
}

function getToolNames(tools: readonly ServerTool[]): string[] {
  return tools.map((tool) => {
    const maybeName = (tool as ServerTool & { readonly name?: string }).name
    return maybeName ?? 'unknown'
  })
}

function makeNamedTool(name: string): ServerTool {
  return { name } as unknown as ServerTool
}

describe('getServerTools', () => {
  it('returns full built-in toolset in full-access mode', () => {
    const context = makeContext({ executionMode: 'full-access', hasProject: true })
    const features = getActiveAgentFeatures(context)

    const toolNames = getToolNames(getServerTools(context, features))

    expect(toolNames).toContain('readFile')
    expect(toolNames).toContain('writeFile')
    expect(toolNames).toContain('editFile')
    expect(toolNames).toContain('runCommand')
    expect(toolNames).toContain('glob')
    expect(toolNames).toContain('listFiles')
    expect(toolNames).toContain('loadSkill')
    expect(toolNames).toContain('askUser')
  })

  it('filters approval-required tools in sandbox mode', () => {
    const context = makeContext({ executionMode: 'sandbox', hasProject: true })
    const features = getActiveAgentFeatures(context)

    const toolNames = getToolNames(getServerTools(context, features))

    expect(toolNames).toContain('readFile')
    expect(toolNames).toContain('glob')
    expect(toolNames).toContain('listFiles')
    expect(toolNames).toContain('loadSkill')
    expect(toolNames).toContain('askUser')

    expect(toolNames).not.toContain('writeFile')
    expect(toolNames).not.toContain('editFile')
    expect(toolNames).not.toContain('runCommand')
  })

  it('returns no tools when no project is selected', () => {
    const context = makeContext({ executionMode: 'full-access', hasProject: false })
    const features = getActiveAgentFeatures(context)

    const tools = getServerTools(context, features)

    expect(tools).toEqual([])
  })

  it('throws when features register duplicate tool names', () => {
    const context = makeContext({ executionMode: 'full-access', hasProject: true })
    const features: AgentFeature[] = [
      {
        id: 'test.dup-a',
        getTools: () => [makeNamedTool('duplicate')],
      },
      {
        id: 'test.dup-b',
        getTools: () => [makeNamedTool('duplicate')],
      },
    ]

    expect(() => getServerTools(context, features)).toThrow(
      'Duplicate tool registration for "duplicate"',
    )
  })
})
