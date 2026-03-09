import { ConversationId, SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import { openaiProvider } from '../../providers/openai'
import { buildSystemPrompt } from '../prompt-pipeline'
import type { AgentPromptFragment, AgentRunContext } from '../runtime-types'
import { agentsEntryPromptFragment, scopedAgentsPromptFragment } from '../standards-prompt'
import { coreBehaviorPromptFragment, runtimeModelPromptFragment } from '../system-prompt'

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

  it('includes least-disclosure and askUser gating guidance in core behavior prompt', () => {
    const context = makeContext()

    const result = coreBehaviorPromptFragment.build(context)

    expect(result).toContain(
      'For short yes/no capability questions, do not use askUser before answering',
    )
    expect(result).toContain(
      'Do not use askUser just to classify broad terms or generate generic taxonomies',
    )
    expect(result).toContain(
      'Do not assume the user wants attachments saved to project files; only save/copy attachment content when the user explicitly asks for it',
    )
    expect(result).toContain(
      'If a user message contains only attachment content and no explicit instruction, ask a neutral clarifying question about intent before taking action',
    )
    expect(result).toContain(
      'Do not frame attachment-only follow-ups as "save to project" by default',
    )
    expect(result).toContain(
      'For attachment-only clarification examples, avoid suggesting save/copy file operations unless the user explicitly asks for file persistence',
    )
    expect(result).toContain(
      'prefer writeFile with attachmentName (or just path when there is exactly one attachment)',
    )
  })

  it('labels runtime model details as internal context', () => {
    const context = makeContext()

    const result = runtimeModelPromptFragment.build(context)

    expect(result).toContain('Internal runtime context')
    expect(result).toContain(
      'do not mention this unless the user asks for technical/runtime details',
    )
  })

  it('orders AGENTS root before scoped AGENTS fragment', () => {
    const baseContext = makeContext()
    const context: AgentRunContext = {
      ...baseContext,
      standards: {
        agentsPath: '/tmp/project/AGENTS.md',
        agentsStatus: 'found',
        agentsInstruction: '# Root',
        agentsRootInstruction: '# Root',
        agentsScopedInstructions: [
          {
            scopeRelativeDir: 'packages/a',
            filePath: '/tmp/project/packages/a/AGENTS.md',
            content: '# Scoped',
          },
        ],
        agentsResolvedFiles: ['/tmp/project/AGENTS.md', '/tmp/project/packages/a/AGENTS.md'],
        catalogSkills: [],
        activation: {
          explicitSkillIds: [],
          heuristicSkillIds: [],
          selectedSkillIds: [],
        },
        activeSkills: [],
        warnings: [],
      },
    }

    const result = buildSystemPrompt(context, [
      scopedAgentsPromptFragment,
      agentsEntryPromptFragment,
    ])

    expect(result.fragmentIds).toEqual(['standards.agents-entry', 'standards.scoped-agents'])
    expect(result.prompt.startsWith('# Root')).toBe(true)
  })
})
