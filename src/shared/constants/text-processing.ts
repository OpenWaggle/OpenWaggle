// Text length thresholds and character limits.

/** Title generation limits */
export const TITLE = {
  /** Max characters of input for title generation */
  INPUT_MAX_CHARS: 500,
  /** Fallback title length */
  FALLBACK_LENGTH: 60,
} as const

/** Skill and prompt limits */
export const PROMPT_LIMITS = {
  /** Max skills in catalog prompt */
  MAX_SKILLS_IN_CATALOG: 20,
  /** Max skill description characters */
  MAX_SKILL_DESCRIPTION_CHARS: 140,
  /** Max agent scopes in prompt */
  MAX_AGENTS_SCOPES: 5,
  /** Max candidates for agent path inference */
  MAX_AGENT_CANDIDATES: 5,
} as const
