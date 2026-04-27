// Text length thresholds, confidence scores, and character limits.

/** Consensus detection thresholds */
export const CONSENSUS = {
  /** Overall consensus threshold */
  THRESHOLD: 0.7,
  /** Confidence for explicit agreement phrases */
  EXPLICIT_AGREEMENT_CONFIDENCE: 0.9,
  /** Confidence for content similarity */
  CONTENT_SIMILARITY_CONFIDENCE: 0.7,
  /** Confidence for shrinking response pattern */
  SHRINKING_RESPONSE_CONFIDENCE: 0.6,
  /** Confidence at turn limit */
  TURN_LIMIT_CONFIDENCE: 0.5,
  /** Jaccard similarity threshold for content comparison */
  JACCARD_SIMILARITY_THRESHOLD: 0.6,
  /** Ratio threshold for shrinking response detection */
  SHRINKING_RATIO_THRESHOLD: 0.4,
  /** Min text length for shrinking detection */
  SHRINKING_MIN_LENGTH: 100,
  /** Turn limit activation ratio */
  TURN_LIMIT_ACTIVATION: 0.75,
  /** Min sentence length for analysis */
  MIN_SENTENCE_LENGTH: 10,
  /** Short message threshold for agreement detection */
  AGREEMENT_SHORT_MSG_THRESHOLD: 500,
  /** Confidence for long message agreement */
  AGREEMENT_LONG_MSG_CONFIDENCE: 0.5,
  /** Min substantive text length */
  MIN_SUBSTANTIVE_LENGTH: 20,
} as const

/** Title generation limits */
export const TITLE = {
  /** Max characters of input for title generation */
  INPUT_MAX_CHARS: 500,
  /** Max tokens for generated title */
  MAX_TOKENS: 60,
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
