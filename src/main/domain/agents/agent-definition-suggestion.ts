/**
 * Whether a spawn's objective restates an Agent definition's role, so the spawn result can name
 * the definition (`suggestedAgent`). Pure: no files, no catalog. The match is lexical and
 * deliberately conservative, because it only ever produces a hint, and a wrong hint would give
 * the next Worker the wrong instructions. A role counts only where the objective states its own
 * role in so many words, the first clause near its start that opens with "You are" or "Act as"
 * ("You are an independent code reviewer with…"), outside any quoted text, and only when the definition's name is the
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

/** A clause: text up to a sentence end or a line break. */
const CLAUSE = /[^.;!?\n]+/gu
/**
 * Bullets, numbers and emphasis before a clause's first word: `- `, `* `, `1) `, `**`. A `1.`
 * needs no branch: the clause split already leaves the `1` as a clause of its own.
 */
const LIST_MARKER = /^(?:[-*•+]+\s*|\d+\)\s*|_+)*/u
/**
 * Text quoted for someone else, blanked before clauses are read: a fenced block, a blockquote
 * line, and a double-quoted span, an unclosed one to the end. Single quotes are left alone, since
 * they are also apostrophes.
 */
// `(?![\s\S])` is the end of the input; `$` is a line end here, under the m flag.
const QUOTED =
  /```[\s\S]*?(?:```|(?![\s\S]))|^[ \t]*>.*$|"[^"]*(?:"|(?![\s\S]))|“[^”]*(?:”|(?![\s\S]))/gmu
/**
 * Openers that address the Worker. A bare "As" or "Acting as" is left out: in an objective it is
 * as often a conjunction or someone else's role ("As the reviewer of PR #405 found, fix…",
 * "Acting as the reviewer, I found…") as the Worker's own.
 */
const ROLE_OPENER = /^(?:you\s+are|you['’]re|act\s+as|serve\s+as|work\s+as)\s+/iu
/** Words that may open the role's noun phrase without being part of it, once, before its words. */
const DETERMINERS = new Set(['a', 'an', 'the', 'our', 'this', 'one', 'another'])
/** Adverbs that may come before the determiner: "You are now the reviewer". */
const LEADING_ADVERBS = new Set(['now', 'also', 'again', 'still'])
/** Bases of a 's that is a contraction ("who's", "it's"), which ends the phrase, not a possessive. */
const CONTRACTION_BASES = new Set(['who', 'that', 'it', 'here', 'there', 'what', 'he', 'she'])
/** Words that end the role's noun phrase: what follows them is not the role itself. */
const PHRASE_BREAKS = new Set(
  'for of to with who whom whose that which on in at from and or but not nor than by about as into over under while when where so then'.split(
    ' ',
  ),
)
/** The longest noun phrase read after the opener, determiner excluded; a longer one is no role. */
const MAX_PHRASE_WORDS = 5
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
  /** The noun phrases the objective states its role with, as written, lowercased. */
  readonly roles: readonly (readonly string[])[]
  /** Stems of the title and the whole objective. */
  readonly all: ReadonlySet<string>
}

function nameWords(name: string) {
  // Every word of the name, short ones included: `ux-reviewer` and `qa` keep their qualifier.
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** Whether a word is a possessive ("reviewer's", "reviewers'"), whose head is the next word. */
function isPossessive(raw: string, word: string) {
  const singular = /^(.*?)['’]s\b/u.exec(word)
  if (singular)
    return !CONTRACTION_BASES.has(singular[1] ?? '') && !PHRASE_BREAKS.has(singular[1] ?? '')
  // A trailing quote after an s is a plural possessive unless the word opened with a quote.
  return /s['’]$/u.test(word.replace(/[^\p{L}\p{N}'’]+$/u, '')) && !/^['’"“‘]/u.test(raw)
}

/**
 * "independent code reviewer" from "an independent code reviewer with a fresh context": the
 * noun phrase right after the opener. A determiner may open it once; one later on means the
 * opener led into something else ("You are helping the reviewer", "As per the reviewer"), and a
 * possessive means its head is another noun ("the reviewer's assistant"), so both give no phrase.
 */
function rolePhrase(rest: string) {
  const phrase: string[] = []
  let opening = true
  for (const raw of rest.split(/\s+/u)) {
    const word = raw.toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '')
    if (isPossessive(raw, word)) return []
    // "who's", "it's": a contraction ends the phrase, as "who" or "it" would.
    if (/['’]s\b/u.test(word)) break
    const core = word.replace(/[^\p{L}\p{N}-]+$/u, '')
    if (core === '' || PHRASE_BREAKS.has(core)) break
    if (opening && LEADING_ADVERBS.has(core)) continue
    if (DETERMINERS.has(core)) {
      if (!opening) return []
      opening = false
      continue
    }
    opening = false
    phrase.push(...nameWords(core))
    if (phrase.length > MAX_PHRASE_WORDS) return []
    if (core !== word) break
  }
  return phrase
}

/**
 * "Act as the reviewer, I found…", "Serve as reviewer: Worker 2 flagged…": a role followed by a
 * separate subject is the speaker's or someone else's, not the Worker's. An imperative after it
 * starts lowercase ("Act as reviewer, review the diff"), so it still states the Worker's role.
 */
const SPEAKER_AFTER_ROLE =
  /^(?:[Aa]ct\s+as|[Ss]erve\s+as|[Ww]ork\s+as)\b[^,:—–]*[,:—–]\s*(?:(?:[Ii]|[Ww]e|[Mm]y|[Oo]ur|[Ii]t|[Tt]hey|[Hh]e|[Ss]he|[Tt]he|[Aa]n?|[Tt]his|[Tt]hat)\b|\p{Lu})/u

/**
 * The objective's role statement: the phrase of the first clause near its start that opens with
 * "You are" or "Act as". Only the first counts, so a later "Act as the reviewer…" does not
 * override "You are the implementer"; an empty phrase there (the opener led elsewhere) means
 * the objective states no role.
 */
function rolePhrases(objective: string) {
  // Someone else's objective quoted here ("Give each Worker this objective: \"You are a
  // reviewer…\"") is never this one's role; blanking keeps every offset where it was.
  const own = objective.replace(QUOTED, (quoted) => ' '.repeat(quoted.length))
  for (const match of own.matchAll(CLAUSE)) {
    if (match.index >= ROLE_OPENING_LENGTH) break
    const opened = match[0].trim().replace(LIST_MARKER, '')
    const opener = ROLE_OPENER.exec(opened)
    if (!opener) continue
    if (SPEAKER_AFTER_ROLE.test(opened)) return []
    return [rolePhrase(opened.slice(opener[0].length))]
  }
  return []
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
  return objective.roles.some(
    (phrase) =>
      namesWord(phrase.at(-1), last) &&
      name.every((word) => phrase.some((phraseWord) => namesWord(phraseWord, word))) &&
      phrase.slice(0, -1).every((word) => isNameWord(word) || ROLE_MODIFIERS.has(word)),
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
