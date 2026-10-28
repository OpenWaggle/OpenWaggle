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

  it('keeps the trigger sentence that follows a long opening and shortens the opening instead', () => {
    const opening =
      `Analyze coding-agent transcript history to show daily token usage ${'broken down by repository and project in detail '.repeat(2)}`.trim()
    const trigger = 'Use when the user asks about agent usage or a token breakdown.'
    const listed = promptSkillDescription(`${opening}. ${trigger} More detail follows here.`)

    expect(listed.length).toBeLessThanOrEqual(SKILL_PROMPT_DESCRIPTION_LIMIT)
    expect(listed).toContain(trigger)
    expect(listed.startsWith('Analyze coding-agent transcript history')).toBe(true)
  })

  it('keeps a trigger introduced by "Use this skill for" or "Triggers on"', () => {
    const opening =
      'Codebase intelligence that finds unused code, duplicates, cycles and complexity hotspots across very large JavaScript and TypeScript repositories'
    for (const trigger of [
      'Use this skill for dead-code audits.',
      'Triggers on fallow or code-health requests.',
    ]) {
      const listed = promptSkillDescription(`${opening}. ${trigger}`)
      expect(listed.length).toBeLessThanOrEqual(SKILL_PROMPT_DESCRIPTION_LIMIT)
      expect(listed).toContain(trigger)
    }
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
