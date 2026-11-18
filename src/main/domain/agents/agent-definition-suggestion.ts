/**
 * Whether a spawn's objective restates an Agent definition's role, so the spawn result can name
 * the definition (`suggestedAgent`). Pure: no files, no catalog. The match is lexical and
 * deliberately conservative, because it only ever produces a hint, and a wrong hint would give
 * the next Worker the wrong instructions. A role counts only where the objective states its own
 * role in so many words (`roleStatement`: "You are an independent code reviewer with…"), and only
 * when the definition's name is the head of that phrase: "the implementer, not the reviewer",
 * "the reviewer's findings", "then hand off to the reviewer" and a title name no role. A share of
 * the definition's description words must then appear anywhere in the title or objective.
 */

import { nameWords, roleStatement } from './agent-definition-role-statement'

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
/**
 * The only words, besides the name's own, that may come before the role's head. Closed on
 * purpose: a verb, a count, a preposition or another role before it ("coordinating three
 * reviewers", "the implementer after reviewers", "no longer reviewer") means the phrase is not a
 * plain statement of the role, and the hint stays silent rather than guess.
 */
const ROLE_MODIFIERS = new Set(
  'independent senior junior lead principal staff dedicated second final fresh context new primary main sole external strict careful thorough skeptical sceptical impartial neutral unbiased critical experienced read only readonly code'.split(
    ' ',
  ),
)
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

function tokens(text: string) {
  return (
    text
      // Not toLocaleLowerCase: under a Turkish locale "I" would not lower to "i".
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word))
  )
}

function words(text: string) {
  return new Set(tokens(text).map(stem))
}

interface ObjectiveWords {
  /** The noun phrase the objective states its role with, as written, lowercased; [] for none. */
  readonly role: readonly string[]
  /** Stems of the title and the whole objective. */
  readonly all: ReadonlySet<string>
}

function namesWord(phraseWord: string | undefined, nameWord: string) {
  return phraseWord === nameWord || phraseWord === `${nameWord}s`
}

/**
 * Whether a role phrase is this name: its head (its last word) the name's last word, every name
 * word in it, and every other word a role modifier, all as written or plural. Unstemmed, so
 * `tester` or `planner` is not named by "the tests" or "the plan".
 */
function namesRole(name: readonly string[], objective: ObjectiveWords) {
  const last = name.at(-1)
  if (last === undefined) return false
  const isNameWord = (phraseWord: string) => name.some((word) => namesWord(phraseWord, word))
  const phrase = objective.role
  return (
    namesWord(phrase.at(-1), last) &&
    name.every((word) => phrase.some((phraseWord) => namesWord(phraseWord, word))) &&
    phrase.slice(0, -1).every((word) => isNameWord(word) || ROLE_MODIFIERS.has(word))
  )
}

function score(candidate: AgentDefinitionCandidate, objective: ObjectiveWords) {
  const name = nameWords(candidate.name)
  if (!namesRole(name, objective)) return undefined
  // The name already passed its own test; counting it again here would give every objective that
  // names the role a free share of a description that repeats the name ("code reviewer").
  const nameStems = new Set(name.map(stem))
  const described = new Set(
    [...words(candidate.description)].filter((word) => !nameStems.has(word)),
  )
  if (described.size < MIN_DESCRIPTION_WORDS) return undefined
  let shared = 0
  for (const word of described) if (objective.all.has(word)) shared += 1
  const share = shared / described.size
  return share >= SUGGESTION_DESCRIPTION_SHARE
    ? { share, nameLength: new Set(name).size }
    : undefined
}

/**
 * The one definition the objective most plainly describes, or undefined when none does or two
 * fit about equally well. A name the objective states more of wins first: "an independent code
 * reviewer" names `code-reviewer` over `reviewer`, though both match it.
 */
export function suggestAgentDefinition(
  input: AgentDefinitionSuggestionInput,
  candidates: readonly AgentDefinitionCandidate[],
) {
  const title = input.title ?? ''
  const objective = {
    role: roleStatement(input.objective),
    all: words(`${title}\n${input.objective}`),
  }
  const ranked = candidates
    .flatMap((candidate) => {
      const value = score(candidate, objective)
      return value === undefined ? [] : [{ candidate, ...value }]
    })
    .sort((left, right) => right.nameLength - left.nameLength || right.share - left.share)
  const [best, runnerUp] = ranked
  if (!best) return undefined
  const tied =
    runnerUp !== undefined &&
    runnerUp.nameLength === best.nameLength &&
    best.share - runnerUp.share < AMBIGUITY_MARGIN
  return tied ? undefined : best.candidate
}
