import { SKILL_ACTIVATION } from '@shared/constants/agent-config'
import type { SkillActivationResult } from '@shared/types/standards'
import { extractExplicitSkillReferences } from '@shared/utils/skill-references'
import type { LoadedSkillDefinition } from './skill-catalog'

export interface SkillActivationDetails extends SkillActivationResult {
  readonly unresolvedExplicitIds: readonly string[]
}

export function activateSkillsFromText(
  text: string,
  skills: readonly LoadedSkillDefinition[],
): SkillActivationDetails {
  const activeSkills = skills.filter((skill) => skill.loadStatus === 'ok' && skill.enabled)
  const explicitIds = findExplicitSkillIds(text, activeSkills)
  const unresolvedExplicitIds = explicitIds.filter((id) => !activeSkills.some((s) => s.id === id))
  const resolvedExplicitIds = explicitIds.filter((id) => activeSkills.some((s) => s.id === id))

  const heuristicIds = findHeuristicSkillIds(text, activeSkills, resolvedExplicitIds)
  const selectedSkillIds = [...new Set([...resolvedExplicitIds, ...heuristicIds])]

  return {
    explicitSkillIds: resolvedExplicitIds,
    heuristicSkillIds: heuristicIds,
    selectedSkillIds,
    unresolvedExplicitIds,
  }
}

function findExplicitSkillIds(text: string, skills: readonly LoadedSkillDefinition[]): string[] {
  const references = extractExplicitSkillReferences(text)
  const explicitIds = [...references.allSkillIds]
  const lowerText = text.toLowerCase()

  for (const skill of skills) {
    if (!matchesWholeToken(lowerText, skill.id) && !matchesWholeText(lowerText, skill.name)) {
      continue
    }

    explicitIds.push(skill.id)
  }

  return [...new Set(explicitIds)]
}

function findHeuristicSkillIds(
  text: string,
  skills: readonly LoadedSkillDefinition[],
  explicitIds: readonly string[],
): string[] {
  const messageTokens = tokenize(text)
  if (messageTokens.size === 0) return []

  const scored = skills
    .filter((skill) => !explicitIds.includes(skill.id))
    .map((skill) => {
      const skillTokens = tokenize(`${skill.name} ${skill.description}`)
      const overlap = countOverlap(messageTokens, skillTokens)
      const score = skillTokens.size > 0 ? overlap / skillTokens.size : 0
      return { skillId: skill.id, score }
    })
    .filter((entry) => entry.score >= SKILL_ACTIVATION.THRESHOLD)
    .sort((a, b) => b.score - a.score || a.skillId.localeCompare(b.skillId))

  return scored.slice(0, SKILL_ACTIVATION.MAX_MATCHES).map((entry) => entry.skillId)
}

function tokenize(value: string): Set<string> {
  const matches = value.toLowerCase().match(/[a-z0-9][a-z0-9-_]*/g)
  return new Set(matches ?? [])
}

function countOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0
  for (const token of a) {
    if (b.has(token)) {
      count += 1
    }
  }
  return count
}

function matchesWholeToken(text: string, token: string): boolean {
  const regex = new RegExp(`(^|\\s)${escapeRegex(token)}(\\s|$)`, 'i')
  return regex.test(text)
}

function matchesWholeText(text: string, value: string): boolean {
  const escaped = escapeRegex(value.toLowerCase())
  if (!escaped) return false
  const regex = new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i')
  return regex.test(text)
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
