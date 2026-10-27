import type { BeforeAgentStartEvent, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import {
  promptSkillDescription,
  promptSkillLocation,
  SKILL_PROMPT_DESCRIPTION_LIMIT,
  skillPromptListingExtension,
} from '../pi-skill-prompt-listing'

describe('skills listing in the system prompt', () => {
  it('names project skills relative to the working directory and user skills under ~', () => {
    expect(promptSkillLocation('/repo/.agents/skills/tdd/SKILL.md', '/repo', '/home/me')).toBe(
      '.agents/skills/tdd/SKILL.md',
    )
    expect(promptSkillLocation('/home/me/.agents/skills/twg/SKILL.md', '/repo', '/home/me')).toBe(
      '~/.agents/skills/twg/SKILL.md',
    )
    expect(promptSkillLocation('/opt/skills/x/SKILL.md', '/repo', '/home/me')).toBe(
      '/opt/skills/x/SKILL.md',
    )
  })

  it('caps long descriptions at a word and keeps short ones whole', () => {
    const long = `${'Use this skill when reviewing pull requests carefully. '.repeat(10)}`
    const capped = promptSkillDescription(long)

    expect(capped.length).toBeLessThanOrEqual(SKILL_PROMPT_DESCRIPTION_LIMIT)
    expect(capped.endsWith('…')).toBe(true)
    expect(promptSkillDescription('Short one.')).toBe('Short one.')
  })

  it('changes only the prompt copy of each skill', async () => {
    let handler: ((event: BeforeAgentStartEvent) => unknown) | undefined
    await skillPromptListingExtension()(
      fromPartial<ExtensionAPI>({
        on: (_name: string, registered: (event: BeforeAgentStartEvent) => unknown) => {
          handler = registered
        },
      }),
    )
    const skill = {
      name: 'tdd',
      filePath: '/repo/.agents/skills/tdd/SKILL.md',
      description: 'TDD.',
    }
    const event = fromPartial<BeforeAgentStartEvent>({
      systemPromptOptions: { cwd: '/repo', skills: [skill] },
    })
    handler?.(event)

    expect(event.systemPromptOptions.skills[0]?.filePath).toBe('.agents/skills/tdd/SKILL.md')
    expect(skill.filePath).toBe('/repo/.agents/skills/tdd/SKILL.md')
  })
})
