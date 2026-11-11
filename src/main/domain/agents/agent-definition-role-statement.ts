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
 * Bullets, numbers, headings and emphasis before a clause's first word: `- `, `1) `, `# `, `**`. A `1.`
 * needs no branch: the clause split already leaves the `1` as a clause of its own.
 */
const LIST_MARKER = /^(?:[-*•+#]+\s*|\d+\)\s*|_+)*/u
/** Only this much of an objective is searched for quotes and statements; the rest is never read. */
const READ_LENGTH = 4096
/**
 * Text quoted for someone else, marked before clauses are read: a fenced block (``` or ~~~), an
 * indented or blockquote line, an inline code span, a double-quoted span (an unclosed one to the
 * end), and a single-quoted one. A single quote counts only with no letter or digit outside it,
 * so an apostrophe ("reviewer's", "it's") neither opens nor closes one, and opens none after
 * closing marks either ("`useHiveTree`'s", "**HivePanel**'s").
 */
const QUOTE_OPENER = String.raw`(?<![\p{L}\p{N}\u0060*_)\]"”’'])['‘]`
// `(?![\s\S])` is the end of the input; `$` is a line end here, under the m flag.
const QUOTE_FORMS = [
  '(```|~~~)[\\s\\S]*?(?:\\1|(?![\\s\\S]))',
  '^(?:[ \\t]*>| {4}|\\t).*$',
  '`[^`\\n]*`',
  '"[^"]*(?:"|(?![\\s\\S]))',
  '“[^”]*(?:”|(?![\\s\\S]))',
  // One quoted word ('tests', 'docs') closes at its own quote.
  `${QUOTE_OPENER}[^\\s'’]+['’](?![\\p{L}\\p{N}])`,
]
/**
 * A single-quoted span. Inside it, an apostrophe before a letter ("it's") goes on, and so does
 * whatever `extra` alternative a reading adds.
 */
function singleQuoted(extra: string) {
  const body = `(?:[^'’]|['’](?=[\\p{L}\\p{N}])${extra})*`
  return `${QUOTE_OPENER}(?=\\S)${body}['’](?![\\p{L}\\p{N}])`
}
/**
 * Two readings of a single quote after an s and before a word: a plural possessive inside the
 * span ("'Ignore the other Workers' findings…'"), or the span's close ("'Unit Tests' check").
 * Nothing tells them apart, so the role is read both ways and counts only when both agree.
 */
const QUOTED_READINGS = [String.raw`|(?<=s)['’](?=[ \t]+\p{L})`, ''].map(
  (extra) => new RegExp([...QUOTE_FORMS, singleQuoted(extra)].join('|'), 'gmu'),
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
const OPENERS = String.raw`you\s+are|you['’]re|act\s+as|serve\s+as|work\s+as`
const ROLE_OPENER = new RegExp(String.raw`^(?:${OPENERS})\s+`, 'iu')
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
/** Breaks that may join a second role without a comma: "the reviewer as well as the fixer". */
const JOINING_BREAKS = new Set(['as', 'then'])
/** The longest noun phrase read after the opener, determiner excluded; a longer one is no role. */
const MAX_PHRASE_WORDS = 5
/** A line ending in a colon, emphasis around it allowed: "Worker objective:", "**Each gets:**". */
const COLON_LINE = /:[\s*_]*$/u
/** A label line that introduces the objective's own text: "Role:", "**Your task:**", "## Context:". */
const OWN_LABEL_HEAD = String.raw`(?:your\s+)?(?:role|task|goal|scope|context|mission|objective)[*_]*\s*:[\s*_]*`
const OWN_LABEL = new RegExp(String.raw`^[\s*_#>-]*${OWN_LABEL_HEAD}$`, 'iu')
/** The same label leading a clause, read past like a list marker: "Objective: You are…". */
const LEADING_OWN_LABEL = new RegExp(`^${OWN_LABEL_HEAD}`, 'iu')
/** Tokens that join a second role as "and" does: "the reviewer & fixer", "reviewer / fixer". */
const ROLE_JOINERS = new Set(['&', '+', '/'])
/** An agent noun, a determiner allowed: "the fixer", "an implementer", "testers". */
const AGENT_NOUN = String.raw`(?:(?:an?|the)\s+)?\p{L}+(?:er|or|ist|ant|ect)s?`
/**
 * After a comma, a dash, "as" or "then", further roles: one joined to the phrase ("the reviewer,
 * and the fixer", "the reviewer — then the fixer", "the reviewer as well as the fixer") or a list ("the planner, implementer and tester").
 * A word there that does not end like an agent noun ("the reviewer, review and report", ", and
 * fix what you find") still reads; one that does (", and consider…", ", then deliver…") drops the
 * phrase, a miss accepted for a hint.
 */
const ROLE_LIST = new RegExp(
  String.raw`^(?:(?:and|or|then|plus|as\s+well\s+as|(?:but\s+)?also|&)\s+${AGENT_NOUN}|${AGENT_NOUN}(?:,\s*${AGENT_NOUN})*,?\s+(?:and|or)\s+${AGENT_NOUN})\b`,
  'iu',
)
/**
 * An opener inside a clause, after a lead-in ("Round 2 — you are the implementer"), followed by
 * a determiner. Without one ("the bug you are seeing") it is no statement.
 */
const EMBEDDED_STATEMENT = new RegExp(
  String.raw`(?:^|[\s,:;—–\]()])(?:${OPENERS})\s+(?:(?:${[...LEADING_ADVERBS].join('|')})\s+)?(?:${[...DETERMINERS].join('|')})\s`,
  'iu',
)
/** A clause that gives the role by a label rather than an opener: "Role: implementer", "Your role is". */
const ROLE_LABEL = /^[\s*_#>-]*(?:your\s+)?role(?:[*_]*\s*:[\s*_]*[^\s*_]|\s+is\b)/iu
/** A dash token that ends the phrase and may lead to a second role: "—", "–", "-", "--". */
const DASH = /^(?:[—–]|-{1,2})$/u
/**
 * An inline colon after a word that introduces someone else's text: "each with this objective:
 * Review…", "Each Worker gets: …". A line that is the objective's own label ("Objective: You
 * are…") does not cut.
 */
const INLINE_INTRODUCER =
  /\b(?:objectives?|prompts?|instructions?|briefs?|messages?|tasks?|following|gets|receives)[*_]*\s*:/giu

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

/** "your own": the words after "of" that make a role a self-check. */
const SELF_CHECK_WORDS = 2

/**
 * What a token does to the phrase before it is read as a word: `drop` the whole phrase (a quoted
 * word, a possessive, a joined second role, a role over "your own" work), `end` it (a
 * contraction: "who's", "it's"), or end it unless further roles follow (`list`, a dash).
 */
function tokenStop(raw: string, following: readonly string[]): 'drop' | 'end' | 'list' | undefined {
  if (raw.startsWith(QUOTE_MARK) || isPluralPossessive(raw) || ROLE_JOINERS.has(raw)) return 'drop'
  if (DASH.test(raw)) return 'list'
  // "the reviewer of your own diff": a role over the Worker's own work is a self-check, not its role.
  if (
    /^of$/iu.test(raw) &&
    /^your\s+own\b/iu.test(following.slice(0, SELF_CHECK_WORDS).join(' '))
  ) {
    return 'drop'
  }
  // "who's", "it's" end the phrase; "the reviewer's assistant" is another noun's phrase.
  const contraction = /^(.*?)['’]s\b/u.exec(raw.toLowerCase())
  if (!contraction) return undefined
  return CONTRACTION_BASES.has(contraction[1] ?? '') ? 'end' : 'drop'
}

/** The phrase, ended at `tokens[index]`, unless further roles follow it (`ROLE_LIST`). */
function endedBefore(phrase: readonly string[], tokens: readonly string[], index: number) {
  return ROLE_LIST.test(tokens.slice(index + 1).join(' ')) ? [] : phrase
}

/** The phrase a break word ends, none when "as well as" or "then" joins a second role to it. */
function phraseBefore(phrase: string[], tokens: readonly string[], index: number, core: string) {
  return JOINING_BREAKS.has(core) ? endedBefore(phrase, tokens, index - 1) : phrase
}

/** What a word before the phrase's first word is: an adverb, a determiner, or "also". */
function openingWord(core: string): 'adverb' | 'determiner' | 'second-role' | undefined {
  // "You are also the reviewer": a second role beside one stated elsewhere, so none.
  if (core === 'also') return 'second-role'
  if (LEADING_ADVERBS.has(core)) return 'adverb'
  return DETERMINERS.has(core) ? 'determiner' : undefined
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
    const stop = tokenStop(raw, tokens.slice(index + 1))
    if (stop === 'list') return endedBefore(phrase, tokens, index)
    if (stop) return stop === 'end' ? phrase : []
    const word = raw.toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '')
    const core = word.replace(/[^\p{L}\p{N}-]+$/u, '')
    if (core === '' || PHRASE_BREAKS.has(core)) return phraseBefore(phrase, tokens, index, core)
    const lead = opening ? openingWord(core) : undefined
    if (lead === 'second-role') return []
    if (lead === 'adverb') continue
    opening = false
    if (lead === 'determiner') continue
    phrase.push(...nameWords(core))
    if (phrase.length > MAX_PHRASE_WORDS) return []
    if (core === word) continue
    return word.endsWith(',') ? endedBefore(phrase, tokens, index) : phrase
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
 * The text up to a colon that introduces what follows: one ending a line ("…each with this
 * objective:", "Worker objective:") or an inline one after an introducing word
 * (`INLINE_INTRODUCER`). After it the text is someone else's, quoted or not. Only a label of the
 * objective's own (`OWN_LABEL`) does not cut.
 */
function beforeIntroducingLine(text: string) {
  let start = 0
  for (const line of text.split('\n')) {
    for (const inline of line.matchAll(INLINE_INTRODUCER)) {
      const end = inline.index + inline[0].length
      if (!OWN_LABEL.test(line.slice(0, end))) return text.slice(0, start + end)
    }
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
  const [possessive, closing] = QUOTED_READINGS.map((quoted) => readRole(objective, quoted))
  return possessive?.join(' ') === closing?.join(' ') ? (possessive ?? []) : []
}

function readRole(objective: string, quoted: RegExp): readonly string[] {
  // Someone else's objective quoted here ("Give each Worker this objective: \"You are a
  // reviewer…\"") is never this one's role.
  const marked = objective
    .slice(0, READ_LENGTH)
    .replace(quoted, (span) => QUOTE_MARK.padEnd(span.length))
  for (const match of beforeIntroducingLine(marked).matchAll(CLAUSE)) {
    if (match.index >= ROLE_OPENING_LENGTH) break
    const opened = match[0].trim().replace(LIST_MARKER, '').replace(LEADING_OWN_LABEL, '')
    const opener = ROLE_OPENER.exec(opened)
    // "For this ticket, you are the implementer": a statement after a lead-in is still the
    // first one, so a later "Act as the reviewer" does not count. It names no role itself.
    if (!opener) {
      // A role given without an opener ("Role: implementer", "Your role is…") is still the
      // first statement, so a later one does not count; it names no role itself. Read with and
      // without an own label before it ("**Task:** Your role is…").
      const plain = opened.replace(/[*_]+/gu, '')
      if (
        EMBEDDED_STATEMENT.test(plain) ||
        ROLE_LABEL.test(match[0].trim().replace(LIST_MARKER, '')) ||
        ROLE_LABEL.test(plain)
      ) {
        return []
      }
      continue
    }
    const rest = opened.slice(opener[0].length)
    // "You are …" addresses the Worker whatever follows; only an "… as" opener can be a speaker's.
    const speaker = !/^you/iu.test(opener[0]) && SPEAKER_AFTER_ROLE.test(rest)
    return speaker ? [] : rolePhrase(rest)
  }
  return []
}
