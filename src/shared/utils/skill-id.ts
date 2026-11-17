/**
 * Pi's namespaced skill invocation prefix. Pi expands a prompt that starts with `/skill:<name>`
 * into the skill's body, and its extension-command lookup reads the name as `skill:<name>`, which
 * no extension registers. A Pi extension command named after the skill can never capture it.
 */
export const SKILL_COMMAND_PREFIX = '/skill:'

/** The prompt text that invokes a skill, as Pi's own skill commands spell it. */
export function skillCommandText(skillId: string) {
  return `${SKILL_COMMAND_PREFIX}${skillId}`
}

export function normalizeSkillId(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9-_]+/g, '-')
    .replaceAll(/-{2,}/g, '-')
    .replaceAll(/^-+|-+$/g, '')
  return normalized || 'skill'
}
