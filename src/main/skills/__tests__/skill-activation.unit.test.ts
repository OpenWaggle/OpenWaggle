import { describe, expect, it } from 'vitest'
import { activateSkillsFromText } from '../skill-activation'
import type { LoadedSkillDefinition } from '../skill-catalog'

function makeSkill(
  id: string,
  name: string,
  description: string,
  enabled = true,
): LoadedSkillDefinition {
  return {
    id,
    name,
    description,
    folderPath: `/tmp/${id}`,
    skillPath: `/tmp/${id}/SKILL.md`,
    hasScripts: false,
    enabled,
    loadStatus: 'ok',
  }
}

describe('activateSkillsFromText', () => {
  it('activates explicit slash and dollar references', () => {
    const skills = [makeSkill('code-review', 'code-review', 'Review diffs')]

    const result = activateSkillsFromText('please run /code-review and $code-review', skills)

    expect(result.explicitSkillIds).toEqual(['code-review'])
    expect(result.selectedSkillIds).toEqual(['code-review'])
  })

  it('activates by exact skill name mention', () => {
    const skills = [makeSkill('frontend-design', 'frontend design', 'Build UI')]

    const result = activateSkillsFromText('Need frontend design help', skills)

    expect(result.explicitSkillIds).toEqual(['frontend-design'])
  })

  it('falls back to heuristic matches when no explicit references exist', () => {
    const skills = [
      makeSkill('sentry-monitor', 'monitoring helper', 'Inspect sentry errors and incidents'),
      makeSkill('browser-automation', 'browser helper', 'Automate browser workflows'),
      makeSkill('imagegen', 'image helper', 'Generate images'),
    ]

    const result = activateSkillsFromText(
      'please inspect sentry incidents and sentry errors from production',
      skills,
    )

    expect(result.explicitSkillIds).toEqual([])
    expect(result.heuristicSkillIds).toContain('sentry-monitor')
    expect(result.selectedSkillIds).toContain('sentry-monitor')
  })

  it('reports unresolved explicit references', () => {
    const skills = [makeSkill('code-review', 'code-review', 'Review code')]
    const result = activateSkillsFromText('use /missing-skill and /code-review', skills)

    expect(result.unresolvedExplicitIds).toEqual(['missing-skill'])
    expect(result.selectedSkillIds).toEqual(['code-review'])
  })

  it('ignores disabled skills', () => {
    const skills = [makeSkill('code-review', 'code-review', 'Review code', false)]
    const result = activateSkillsFromText('use /code-review', skills)

    expect(result.selectedSkillIds).toEqual([])
    expect(result.unresolvedExplicitIds).toEqual(['code-review'])
  })
})
