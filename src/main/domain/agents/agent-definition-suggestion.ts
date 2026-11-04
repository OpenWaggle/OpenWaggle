/**
 * Whether a spawn's objective restates an Agent definition's role, so the spawn result can name
 * the definition (`suggestedAgent`). Pure: no files, no catalog. The match is lexical and
 * deliberately conservative, because it only ever produces a hint. A role is stated in the title
 * and the objective's opening ("You are an independent code reviewer…"), while a long objective
 * mentions every role in passing ("then spawn a reviewer"), so the definition's name must appear
 * there, and a share of its description's words anywhere in the objective.
 */

export interface AgentDefinitionCandidate {
  readonly name: string
  readonly description: string
}

export interface AgentDefinitionSuggestionInput {
  readonly objective: string
  readonly title?: string
}

/** Share of a definition's description words the objective must use. */
export const SUGGESTION_DESCRIPTION_SHARE = 0.25
/** How much of the objective's start counts as where it states the role. */
export const ROLE_OPENING_LENGTH = 240
/** A definition needs at least this many description words to be compared at all. */
const MIN_DESCRIPTION_WORDS = 4
/** Words shorter than this carry no role. */
const MIN_WORD_LENGTH = 3
/** The suffix-stripped stem must keep at least this many characters. */
const MIN_STEM_LENGTH = 4
/** Two candidates this close in score are ambiguous, and neither is suggested. */
const AMBIGUITY_MARGIN = 0.05

/** Words every role description shares; they say nothing about which role. */
const STOP_WORDS = new Set([
  'about',
  'after',
  'against',
  'agent',
  'agents',
  'also',
  'and',
  'any',
  'are',
  'before',
  'but',
  'can',
  'does',
  'each',
  'for',
  'from',
  'has',
  'have',
  'into',
  'its',
  'need',
  'needs',
  'not',
  'one',
  'only',
  'other',
  'our',
  'should',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'this',
  'use',
  'used',
  'uses',
  'using',
  'was',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'will',
  'with',
  'without',
  'you',
  'your',
])

const SUFFIXES = ['ings', 'ing', 'ers', 'er', 'ed', 'es', 's'] as const

function stem(word: string) {
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= MIN_STEM_LENGTH) {
      return word.slice(0, -suffix.length)
    }
  }
  return word
}

function words(text: string) {
  const stems = new Set<string>()
  for (const word of text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < MIN_WORD_LENGTH || STOP_WORDS.has(word)) continue
    stems.add(stem(word))
  }
  return stems
}

function score(
  candidate: AgentDefinitionCandidate,
  objective: { readonly role: ReadonlySet<string>; readonly all: ReadonlySet<string> },
) {
  const nameWords = words(candidate.name)
  if (nameWords.size === 0 || ![...nameWords].every((word) => objective.role.has(word))) {
    return undefined
  }
  // The name already passed its own test; counting it again here would give every objective that
  // names the role a free share of a description that repeats the name ("code reviewer").
  const described = new Set(
    [...words(candidate.description)].filter((word) => !nameWords.has(word)),
  )
  if (described.size < MIN_DESCRIPTION_WORDS) return undefined
  let shared = 0
  for (const word of described) if (objective.all.has(word)) shared += 1
  const share = shared / described.size
  return share >= SUGGESTION_DESCRIPTION_SHARE ? share : undefined
}

/**
 * The one definition the objective most plainly describes, or undefined when none does or two
 * fit about equally well.
 */
export function suggestAgentDefinition(
  input: AgentDefinitionSuggestionInput,
  candidates: readonly AgentDefinitionCandidate[],
): AgentDefinitionCandidate | undefined {
  const title = input.title ?? ''
  const objective = {
    role: words(`${title}\n${input.objective.slice(0, ROLE_OPENING_LENGTH)}`),
    all: words(`${title}\n${input.objective}`),
  }
  const ranked = candidates
    .flatMap((candidate) => {
      const value = score(candidate, objective)
      return value === undefined ? [] : [{ candidate, value }]
    })
    .sort((left, right) => right.value - left.value)
  const [best, runnerUp] = ranked
  if (!best) return undefined
  if (runnerUp && best.value - runnerUp.value < AMBIGUITY_MARGIN) return undefined
  return best.candidate
}
