import { ConversationId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import { describe, expect, it } from 'vitest'
import { openaiProvider } from '../providers/openai'
import type { AgentRunContext } from './runtime-types'
import { skillCatalogPromptFragment } from './standards-prompt'

function makeSkill(
  index: number,
  description = `Skill description ${String(index)}`,
): SkillDiscoveryItem {
  return {
    id: `skill-${String(index)}`,
    name: `Skill ${String(index)}`,
    description,
    folderPath: `/tmp/project/.openhive/skills/skill-${String(index)}`,
    skillPath: `/tmp/project/.openhive/skills/skill-${String(index)}/SKILL.md`,
    hasScripts: false,
    enabled: true,
    loadStatus: 'ok',
  }
}

function makeContext(catalogSkills: SkillDiscoveryItem[]): AgentRunContext {
  return {
    runId: 'run-standards-prompt',
    conversation: {
      id: ConversationId('conv-standards-prompt'),
      title: 'Standards prompt test',
      projectPath: '/tmp/project',
      messages: [],
      createdAt: 0,
      updatedAt: 0,
    },
    model: 'gpt-4.1-mini',
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
    standards: {
      agentsPath: '/tmp/project/AGENTS.md',
      agentsStatus: 'found',
      agentsInstruction: '# Rules',
      catalogSkills,
      activation: {
        explicitSkillIds: [],
        heuristicSkillIds: [],
        selectedSkillIds: [],
      },
      activeSkills: [],
      warnings: [],
    },
  }
}

describe('skillCatalogPromptFragment', () => {
  it('bounds listed skills and reports overflow', () => {
    const skills = Array.from({ length: 25 }, (_, index) => makeSkill(index + 1))
    const context = makeContext(skills)

    const prompt = skillCatalogPromptFragment.build(context)

    expect(prompt).toContain('Available project skills (metadata only):')
    expect(prompt).toContain('- skill-20: Skill description 20')
    expect(prompt).not.toContain('- skill-21: Skill description 21')
    expect(prompt).toContain('... and 5 more available skills')
  })

  it('truncates long descriptions', () => {
    const longDescription = 'a'.repeat(200)
    const context = makeContext([makeSkill(1, longDescription)])

    const prompt = skillCatalogPromptFragment.build(context)

    expect(prompt).toContain('...')
    expect(prompt).not.toContain(longDescription)
  })
})
