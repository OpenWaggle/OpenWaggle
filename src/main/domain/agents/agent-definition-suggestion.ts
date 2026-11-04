/**
 * Whether a spawn's objective restates an Agent definition's role, so the spawn result can name
 * the definition (`suggestedAgent`). Pure: no files, no catalog. The match is lexical and
 * deliberately conservative, because it only ever produces a hint, and a wrong hint would give
 * the next Worker the wrong instructions. A role counts only where the objective states its own
 * role in so many words, a clause near its start that opens with "You are", "Act as" or "As"
 * ("You are an independent code reviewer with…"), and only when the definition's name is the
 * head of that phrase: "the implementer, not the reviewer", "the reviewer's findings", "then hand
 * off to the reviewer" and a title name no role. A share of the definition's description words
 * must then appear anywhere in the title or objective.
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
/** A role phrase counts only in a clause that starts within this many characters. */
export const ROLE_OPENING_LENGTH = 240

const CLAUSE_END = /[.;!?\n]+/u
const ROLE_OPENER = /^(?:you are|you['’]re|act as|acting as|serve as|work as|as)\s+/iu
/** Words that may open the role's noun phrase without being part of it. */
const DETERMINERS = new Set(['a', 'an', 'the', 'our', 'this', 'one', 'another'])
/** Words that end the role's noun phrase: what follows them is not the role itself. */
const PHRASE_BREAKS = new Set(
  'for of to with who whom whose that which on in at from and or but not nor than by about as into over under while when where so then'.split(
    ' ',
  ),
)
/** The longest noun phrase read after the opener, determiner excluded. */
const MAX_PHRASE_WORDS = 5
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
  /** The noun phrases the objective states its role with, as written, lowercased. */
  readonly roles: readonly (readonly string[])[]
  /** Stems of the title and the whole objective. */
  readonly all: ReadonlySet<string>
}

/** "independent code reviewer" from "an independent code reviewer with a fresh context". */
function rolePhrase(rest: string) {
  const phrase: string[] = []
  for (const [index, raw] of rest.split(/\s+/u).entries()) {
    const word = raw.toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '')
    // "the reviewer's findings": the role is what follows the possessive, never read here.
    if (/['’]s\b/u.test(word)) return []
    const core = word.replace(/[^\p{L}\p{N}-]+$/u, '')
    if (core === '' || PHRASE_BREAKS.has(core)) break
    if (!(index === 0 && DETERMINERS.has(core))) phrase.push(...core.split('-').filter(Boolean))
    if (core !== word || phrase.length >= MAX_PHRASE_WORDS) break
  }
  return phrase
}

/** The role phrases of the clauses that open with "You are", "Act as" or "As" near the start. */
function rolePhrases(objective: string) {
  const phrases: string[][] = []
  let offset = 0
  for (const clause of objective.split(CLAUSE_END)) {
    if (offset >= ROLE_OPENING_LENGTH) break
    offset += clause.length + 1
    const opened = clause.trim().replace(/^[^\p{L}]+/u, '')
    const opener = ROLE_OPENER.exec(opened)
    if (opener) phrases.push(rolePhrase(opened.slice(opener[0].length)))
  }
  return phrases
}

function namesWord(phraseWord: string | undefined, nameWord: string) {
  return phraseWord === nameWord || phraseWord === `${nameWord}s`
}

/**
 * Whether a role phrase is this name: every name word in it, as written or plural, and the
 * phrase's head (its last word) the name's last word. Unstemmed, so `tester` or `planner` is not
 * named by "the tests" or "the plan".
 */
function namesRole(nameWords: readonly string[], objective: ObjectiveWords) {
  const last = nameWords.at(-1)
  if (last === undefined) return false
  return objective.roles.some(
    (phrase) =>
      namesWord(phrase.at(-1), last) &&
      nameWords.every((word) => phrase.some((phraseWord) => namesWord(phraseWord, word))),
  )
}

function score(candidate: AgentDefinitionCandidate, objective: ObjectiveWords) {
  const nameWords = tokens(candidate.name)
  if (!namesRole(nameWords, objective)) return undefined
  // The name already passed its own test; counting it again here would give every objective that
  // names the role a free share of a description that repeats the name ("code reviewer").
  const nameStems = new Set(nameWords.map(stem))
  const described = new Set(
    [...words(candidate.description)].filter((word) => !nameStems.has(word)),
  )
  if (described.size < MIN_DESCRIPTION_WORDS) return undefined
  let shared = 0
  for (const word of described) if (objective.all.has(word)) shared += 1
  const share = shared / described.size
  return share >= SUGGESTION_DESCRIPTION_SHARE
    ? { share, nameLength: new Set(nameWords).size }
    : undefined
}

/**
 * The one definition the objective most plainly describes, or undefined when none does or two
 * fit about equally well. A name the objective states more of wins first: "security reviewer"
 * names `security-reviewer`, though the generic `reviewer` may share more of its description.
 */
export function suggestAgentDefinition(
  input: AgentDefinitionSuggestionInput,
  candidates: readonly AgentDefinitionCandidate[],
): AgentDefinitionCandidate | undefined {
  const title = input.title ?? ''
  const objective = {
    roles: rolePhrases(input.objective),
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
