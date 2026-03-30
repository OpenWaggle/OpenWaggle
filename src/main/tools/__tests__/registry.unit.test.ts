import { ConversationId, SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import { getActiveAgentFeatures } from '../../agent/feature-registry'
import type { AgentFeature, AgentRunContext } from '../../agent/runtime-types'
import type { DomainServerTool } from '../../ports/tool-types'
import { openaiProvider } from '../../providers/openai'
import { getServerTools } from '../registry'

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
    model: SupportedModelId('gpt-4.1-mini'),
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

function getToolNames(tools: readonly DomainServerTool[]): string[] {
  return tools.map((tool) => {
    const maybeName = (tool as DomainServerTool & { readonly name?: string }).name
    return maybeName ?? 'unknown'
  })
}

function makeNamedTool(name: string): DomainServerTool {
  return { name } as unknown as DomainServerTool
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
    expect(toolNames).toContain('loadAgents')
    expect(toolNames).toContain('loadSkill')
    expect(toolNames).toContain('askUser')
    expect(toolNames).toContain('webFetch')
  })

  it('keeps all tools available in default-permissions mode (approval handled by TanStack)', () => {
    const context = makeContext({ executionMode: 'default-permissions', hasProject: true })
    const features = getActiveAgentFeatures(context)

    const toolNames = getToolNames(getServerTools(context, features))

    // Read-only tools available
    expect(toolNames).toContain('readFile')
    expect(toolNames).toContain('glob')
    expect(toolNames).toContain('listFiles')
    expect(toolNames).toContain('loadAgents')
    expect(toolNames).toContain('loadSkill')
    expect(toolNames).toContain('askUser')

    // Approval-required tools are now kept — TanStack handles the approval flow
    expect(toolNames).toContain('writeFile')
    expect(toolNames).toContain('editFile')
    expect(toolNames).toContain('runCommand')
    expect(toolNames).toContain('webFetch')
  })

  it('returns no built-in tools when no project is selected', () => {
    const context = makeContext({ executionMode: 'full-access', hasProject: false })
    const features = getActiveAgentFeatures(context)

    const toolNames = getToolNames(getServerTools(context, features))

    // Built-in file tools are hidden without a project
    expect(toolNames).not.toContain('readFile')
    expect(toolNames).not.toContain('writeFile')
    expect(toolNames).not.toContain('glob')
    expect(toolNames).not.toContain('webFetch')
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
