import { DOUBLE_FACTOR, TRIPLE_FACTOR } from '@shared/constants/constants'

export interface ExplicitSkillReferences {
  readonly slashSkillIds: readonly string[]
  readonly dollarSkillIds: readonly string[]
  readonly allSkillIds: readonly string[]
}

const SKILL_REFERENCE_REGEX = /(^|\s)([/$])([a-z0-9][a-z0-9-_]*)(?=$|\s|[.,!?;:)\]}>"'])/gi

export function extractExplicitSkillReferences(text: string): ExplicitSkillReferences {
  const slashSkillIds: string[] = []
  const dollarSkillIds: string[] = []
  const seenSlash = new Set<string>()
  const seenDollar = new Set<string>()

  let match: RegExpExecArray | null = SKILL_REFERENCE_REGEX.exec(text)
  while (match) {
    const marker = match[DOUBLE_FACTOR]
    const rawSkillId = match[TRIPLE_FACTOR]
    if (marker && rawSkillId) {
      const skillId = rawSkillId.toLowerCase()
      if (marker === '/' && !seenSlash.has(skillId)) {
        seenSlash.add(skillId)
        slashSkillIds.push(skillId)
      }
      if (marker === '$' && !seenDollar.has(skillId)) {
        seenDollar.add(skillId)
        dollarSkillIds.push(skillId)
      }
    }
    match = SKILL_REFERENCE_REGEX.exec(text)
  }

  const allSkillIds = [...new Set([...slashSkillIds, ...dollarSkillIds])]
  return { slashSkillIds, dollarSkillIds, allSkillIds }
}
