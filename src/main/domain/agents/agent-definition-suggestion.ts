/**
 * Whether a spawn's objective restates an Agent definition's role, so the spawn result can name
 * the definition (`suggestedAgent`). Pure: no files, no catalog. The match is lexical and
 * deliberately conservative, because it only ever produces a hint. A role is stated in the title
 * and the objective's opening ("You are an independent code reviewer…"), while a long objective
 * mentions every role in passing ("then spawn a reviewer"), so the definition's name must appear
 * there, and a share of its description's words anywhere in the objective. A short objective
 * names the next role early too ("Fix the tests, then hand off to the reviewer"), so "there" is
 * the title, the objective's first clause, and an explicit "you are … / act as …" phrase.
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
/** How much of the objective's start is searched for a "you are … / act as …" phrase. */
export const ROLE_OPENING_LENGTH = 240

const CLAUSE_END = /[.;,:!?\n]/u
const ROLE_PHRASE = /\b(?:you are|you're|act as|acting as|serve as|work as)\b[^.;!?\n]*/giu
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
  return text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word))
}

function words(text: string) {
  return new Set(tokens(text).map(stem))
}

interface ObjectiveWords {
  /** The title and the objective's opening, as written: where a role is stated. */
  readonly role: ReadonlySet<string>
  /** Stems of the title and the whole objective. */
  readonly all: ReadonlySet<string>
}

/**
 * Whether the name's words, as written or plural, are where the role is stated. Unstemmed, so a
 * `tester` or `planner` definition is not named by "run the tests" or "plan the work".
 */
function namesRole(nameWords: readonly string[], objective: ObjectiveWords) {
  return (
    nameWords.length > 0 &&
    nameWords.every((word) => objective.role.has(word) || objective.role.has(`${word}s`))
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

/** Where an objective states its own role: its first clause and any "you are … / act as …". */
function roleStatements(objective: string) {
  const text = objective.trimStart()
  const opening = text.slice(0, ROLE_OPENING_LENGTH)
  return [text.split(CLAUSE_END, 1)[0] ?? '', ...(opening.match(ROLE_PHRASE) ?? [])]
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
    role: new Set(tokens(`${title}\n${roleStatements(input.objective).join('\n')}`)),
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
