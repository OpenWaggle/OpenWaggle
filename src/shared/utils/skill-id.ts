/**
 * Pi's namespaced skill invocation prefix. Pi expands a prompt that starts with `/skill:<name>`
 * into the skill's body, and its extension-command lookup reads the name as `skill:<name>`, which
 * an extension named after the skill does not register. Only an extension that spells out the
 * namespaced name itself can intercept it.
 */
export const SKILL_COMMAND_PREFIX = '/skill:'

/**
 * The prompt text that invokes a skill, as Pi's own skill commands spell it. `skillName` is the
 * `name` in SKILL.md's frontmatter — Pi matches that, not the folder the skill lives in, and it
 * passes an unmatched name through without a diagnostic.
 */
export function skillCommandText(skillName: string) {
  return `${SKILL_COMMAND_PREFIX}${skillName}`
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
