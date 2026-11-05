/**
 * Where a spawn objective states its own role: the noun phrase of its first role statement
 * ("You are an independent code reviewer…") outside quoted or introduced text. Pure, and read only
 * by the Agent definition suggestion.
 */

/** A role phrase counts only in a clause that starts within this many characters. */
export const ROLE_OPENING_LENGTH = 240

/** A clause: text up to a sentence end or a line break. */
const CLAUSE = /[^.;!?\n]+/gu
/**
 * Bullets, numbers and emphasis before a clause's first word: `- `, `* `, `1) `, `**`. A `1.`
 * needs no branch: the clause split already leaves the `1` as a clause of its own.
 */
const LIST_MARKER = /^(?:[-*•+]+\s*|\d+\)\s*|_+)*/u
/** Only this much of an objective is searched for quotes and statements; the rest is never read. */
const READ_LENGTH = 4096
/**
 * Text quoted for someone else, marked before clauses are read: a fenced block (``` or ~~~), an
 * indented or blockquote line, an inline code span, a double-quoted span (an unclosed one to the
 * end), and a single-quoted one. A single quote counts only with no letter or digit outside it,
 * so an apostrophe ("reviewer's", "it's") neither opens nor closes one.
 */
// `(?![\s\S])` is the end of the input; `$` is a line end here, under the m flag.
const QUOTED = new RegExp(
  [
    '(```|~~~)[\\s\\S]*?(?:\\1|(?![\\s\\S]))',
    '^(?:[ \\t]*>| {4}|\\t).*$',
    '`[^`\\n]*`',
    '"[^"]*(?:"|(?![\\s\\S]))',
    '“[^”]*(?:”|(?![\\s\\S]))',
    // One quoted word ('tests', 'docs') closes at its own quote, before the longer form below
    // could read that quote as a possessive and run on to an unrelated later quote.
    "(?<![\\p{L}\\p{N}])['‘][^\\s'’]+['’](?![\\p{L}\\p{N}])",
    // Inside, an apostrophe before a letter ("it's") or a plural possessive ("Workers' findings")
    // goes on; greedy, the span still falls back to that s' when no later quote closes it.
    "(?<![\\p{L}\\p{N}])['‘](?=\\S)(?:[^'’]|['’](?=[\\p{L}\\p{N}])|(?<=s)['’](?=[ \\t]+\\p{Ll}))*['’](?![\\p{L}\\p{N}])",
  ].join('|'),
  'gmu',
)
/**
 * What a quoted span becomes: one mark, then spaces, so every offset stays where it was. A role
 * phrase that reaches the mark is no role ("You are \"not\" the reviewer", "the reviewer
 * \"assistant\""), and an opener whose whole phrase is quoted still ends the scan with none.
 */
const QUOTE_MARK = '\uE000'
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
/**
 * Words that end the role's noun phrase: what follows them is not the role itself. "and" and "or"
 * are not among them: "the reviewer and fixer" reads on to its head, "fixer", which no single
 * definition's name is.
 */
const PHRASE_BREAKS = new Set(
  'for of to with who whom whose that which on in at from not than by about as into over under while when where so then'.split(
    ' ',
  ),
)
/** The longest noun phrase read after the opener, determiner excluded; a longer one is no role. */
const MAX_PHRASE_WORDS = 5
/** A line ending in a colon, emphasis around it allowed: "Worker objective:", "**Each gets:**". */
const COLON_LINE = /:[\s*_]*$/u
/** A label line that introduces the objective's own text: "Role:", "**Your task:**", "## Context:". */
const OWN_LABEL =
  /^[\s*_#>-]*(?:your\s+)?(?:role|task|goal|scope|context|mission|objective)[*_]*\s*:[\s*_]*$/iu
/** Tokens that join a second role as "and" does: "the reviewer & fixer", "reviewer / fixer". */
const ROLE_JOINERS = new Set(['&', '+', '/'])
/**
 * After a comma, a list of further roles ("the planner, implementer and tester"): agent nouns
 * joined by commas and a last "and" or "or". A verb after the comma ("the reviewer, review and
 * report") is not one, so the phrase still reads.
 */
const ROLE_LIST =
  /^(?:(?:an?|the)\s+)?\p{L}+(?:er|or|ist|ant|ect)s?(?:,\s*(?:(?:an?|the)\s+)?\p{L}+(?:er|or|ist|ant|ect)s?)*,?\s+(?:and|or)\s+(?:(?:an?|the)\s+)?\p{L}+(?:er|or|ist|ant|ect)s?\b/iu

export function nameWords(name: string) {
  // Every word of the name, short ones included: `ux-reviewer` and `qa` keep their qualifier.
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** Whether a word is a plural possessive ("reviewers'"), whose head is the next word. */
function isPluralPossessive(word: string) {
  return /s['’]$/u.test(word.replace(/[^\p{L}\p{N}'’]+$/u, ''))
}

/**
 * What a token does to the phrase before it is read as a word: `drop` the whole phrase (a quoted
 * word, a possessive, a joined second role), `end` it (a contraction: "who's", "it's"), or nothing.
 */
function tokenStop(raw: string): 'drop' | 'end' | undefined {
  if (raw.startsWith(QUOTE_MARK) || isPluralPossessive(raw) || ROLE_JOINERS.has(raw)) return 'drop'
  // "who's", "it's" end the phrase; "the reviewer's assistant" is another noun's phrase.
  const contraction = /^(.*?)['’]s\b/u.exec(raw.toLowerCase())
  if (!contraction) return undefined
  return CONTRACTION_BASES.has(contraction[1] ?? '') ? 'end' : 'drop'
}

/**
 * "independent code reviewer" from "an independent code reviewer with a fresh context": the
 * noun phrase right after the opener, a determiner that opens it left out. A possessive means
 * its head is another noun ("the reviewer's assistant"), so it gives no phrase.
 */
function rolePhrase(rest: string) {
  const phrase: string[] = []
  let opening = true
  const tokens = rest.split(/\s+/u)
  for (const [index, raw] of tokens.entries()) {
    const stop = tokenStop(raw)
    if (stop) return stop === 'end' ? phrase : []
    const word = raw.toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '')
    const core = word.replace(/[^\p{L}\p{N}-]+$/u, '')
    if (core === '' || PHRASE_BREAKS.has(core)) break
    if (opening && LEADING_ADVERBS.has(core)) continue
    const opens = opening
    opening = false
    if (opens && DETERMINERS.has(core)) continue
    phrase.push(...nameWords(core))
    if (phrase.length > MAX_PHRASE_WORDS) return []
    if (core === word) continue
    const listed = word.endsWith(',') && ROLE_LIST.test(tokens.slice(index + 1).join(' '))
    return listed ? [] : phrase
  }
  return phrase
}

/**
 * "Act as the reviewer, I found…", "Serve as reviewer: Worker 2 flagged…": a role followed by a
 * separate subject is the speaker's or someone else's, not the Worker's. An imperative after it
 * starts lowercase ("Act as reviewer, review the diff"), so it still states the Worker's role.
 * Read on the text after an "Act as", "Serve as" or "Work as" opener, whatever its case.
 */
// The separator is the first comma, colon, dash (an ASCII one spaced: " - ", " -- ") or ellipsis.
const SPEAKER_AFTER_ROLE =
  /^(?:[^,:—–…\s]|\s(?!-{1,2}\s))*(?:[,:—–…]|\s-{1,2}(?=\s))\s*(?:(?:[Ii]|[Ww]e|[Mm]y|[Oo]ur|[Ii]t|[Tt]hey|[Hh]e|[Ss]he|[Tt]he|[Aa]n?|[Tt]his|[Tt]hat)\b|\p{Lu})/u

/**
 * The text up to the end of a line that ends in a colon and introduces what follows ("…each
 * with this objective:", "Worker objective:"), after which the text is someone else's, quoted or
 * not. Only a label of the objective's own (`OWN_LABEL`) does not cut.
 */
function beforeIntroducingLine(text: string) {
  let start = 0
  for (const line of text.split('\n')) {
    start += line.length + 1
    if (COLON_LINE.test(line) && !OWN_LABEL.test(line)) return text.slice(0, start)
  }
  return text
}

/**
 * The objective's role statement: the phrase of the first clause near its start that opens with
 * "You are", "You're", "Act as", "Serve as" or "Work as". Only the first counts, so a later "Act
 * as the reviewer…" does not override "You are the implementer"; an empty phrase there (the
 * opener led elsewhere) means the objective states no role.
 */
export function roleStatement(objective: string): readonly string[] {
  // Someone else's objective quoted here ("Give each Worker this objective: \"You are a
  // reviewer…\"") is never this one's role.
  const marked = objective
    .slice(0, READ_LENGTH)
    .replace(QUOTED, (quoted) => QUOTE_MARK.padEnd(quoted.length))
  for (const match of beforeIntroducingLine(marked).matchAll(CLAUSE)) {
    if (match.index >= ROLE_OPENING_LENGTH) break
    const opened = match[0].trim().replace(LIST_MARKER, '')
    const opener = ROLE_OPENER.exec(opened)
    if (!opener) continue
    const rest = opened.slice(opener[0].length)
    // "You are …" addresses the Worker whatever follows; only an "… as" opener can be a speaker's.
    const speaker = !/^you/iu.test(opener[0]) && SPEAKER_AFTER_ROLE.test(rest)
    return speaker ? [] : rolePhrase(rest)
  }
  return []
}
