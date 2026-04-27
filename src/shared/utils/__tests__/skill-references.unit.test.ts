import { describe, expect, it } from 'vitest'
import { extractExplicitSkillReferences } from '../skill-references'

describe('extractExplicitSkillReferences', () => {
  it('extracts slash and dollar skill references and deduplicates them', () => {
    const result = extractExplicitSkillReferences(
      'Use /code-review and /code-review plus $frontend-design in this run.',
    )

    expect(result.slashSkillIds).toEqual(['code-review'])
    expect(result.dollarSkillIds).toEqual(['frontend-design'])
    expect(result.allSkillIds).toEqual(['code-review', 'frontend-design'])
  })

  it('ignores markers that do not start a token', () => {
    const result = extractExplicitSkillReferences(
      'Path-like token src/components/button and foo/bar',
    )

    expect(result.allSkillIds).toEqual([])
  })

  it('ignores absolute path segments', () => {
    const result = extractExplicitSkillReferences('Please inspect /tmp/repo/.openwaggle/skills')
    expect(result.allSkillIds).toEqual([])
  })

  it('captures slash references at the start of the prompt', () => {
    const result = extractExplicitSkillReferences('/pi-integration fix this issue')

    expect(result.slashSkillIds).toEqual(['pi-integration'])
    expect(result.allSkillIds).toEqual(['pi-integration'])
  })
})
