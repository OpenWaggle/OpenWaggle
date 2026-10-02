import { Schema, safeDecodeUnknown } from '@shared/schema'
import { DEFAULT_SESSION_TITLE } from '@shared/session-title-source'
import { UNSAFE_TITLE_CHARACTERS } from './session-title-text'

export interface GeneratedSessionTitle {
  readonly title: string
  /** The model could not tell what the Session is about, so one Title refinement is owed. */
  readonly needsRefinement: boolean
}

/**
 * Prompts ask for fewer than 40 characters. This cap only stops a runaway model from pushing a
 * paragraph into the sidebar, header, and window title.
 */
export const GENERATED_SESSION_TITLE_MAX_LENGTH = 80
const ELLIPSIS = '...'

const generatedTitleSchema = Schema.Struct({
  title: Schema.String,
  needsRefinement: Schema.optional(Schema.Boolean),
})

/** Placeholders a model sometimes returns instead of a title; none of them identifies a Session. */
const PLACEHOLDER_TITLES = new Set([
  DEFAULT_SESSION_TITLE.toLowerCase(),
  'openwaggle session',
  'session',
  'untitled',
  'untitled session',
  'title',
])

const THINKING_BLOCK = /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi
const CODE_FENCE = /^```(?:json)?\s*|\s*```$/g
const JSON_OBJECT = /\{[\s\S]*\}/
const TITLE_LABEL = /^(?:title|session title)\s*:\s*/i
/** A preamble such as "Sure! Here is a title:" introduces the answer on the next line. */
const PREAMBLE_LINE = /:\s*$/
const WRAPPING_QUOTES = /^["'`“”‘’]+|["'`“”‘’]+$/g
const TRAILING_PUNCTUATION = /[\s.!?,;:]+$/

function decodeJsonTitle(text: string) {
  const match = JSON_OBJECT.exec(text)
  if (!match) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return null
  }
  const decoded = safeDecodeUnknown(generatedTitleSchema, parsed)
  return decoded.success ? decoded.data : null
}

/** Cuts by code point, so an emoji or astral character is never split into a lone surrogate. */
function boundTitle(title: string) {
  if (title.length <= GENERATED_SESSION_TITLE_MAX_LENGTH) return title
  let cut = ''
  for (const character of title) {
    if (cut.length + character.length > GENERATED_SESSION_TITLE_MAX_LENGTH - ELLIPSIS.length) break
    cut += character
  }
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}${ELLIPSIS}`
}

/** Quotes and trailing punctuation can wrap each other, as in `"Fix it."` or `"Fix it"!`. */
function stripWrapping(text: string) {
  let current = text.trim()
  while (true) {
    const next = current.replace(WRAPPING_QUOTES, '').replace(TRAILING_PUNCTUATION, '').trim()
    if (next === current) return current
    current = next
  }
}

/** One line, no label, quotes, or trailing punctuation; null when nothing usable is left. */
export function sanitizeGeneratedSessionTitle(raw: string) {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(UNSAFE_TITLE_CHARACTERS, ' ').trim())
    .filter((line) => line.length > 0)
  const firstLine = lines.find((line) => !PREAMBLE_LINE.test(line)) ?? lines[0]
  if (!firstLine) return null
  const title = stripWrapping(firstLine.replace(TITLE_LABEL, '').replace(/\s+/g, ' '))
  if (!title || PLACEHOLDER_TITLES.has(title.toLowerCase())) return null
  return boundTitle(title)
}

/**
 * Reads a Title model reply. Models are asked for JSON, but some wrap it in a code fence or a
 * thinking block, and some answer with the bare title; all three are accepted.
 */
export function parseGeneratedSessionTitle(raw: string): GeneratedSessionTitle | null {
  const text = raw.replace(THINKING_BLOCK, '').trim().replace(CODE_FENCE, '').trim()
  if (!text) return null
  const decoded = decodeJsonTitle(text)
  if (decoded) {
    const title = sanitizeGeneratedSessionTitle(decoded.title)
    return title ? { title, needsRefinement: decoded.needsRefinement === true } : null
  }
  if (text.startsWith('{')) return null
  const title = sanitizeGeneratedSessionTitle(text)
  return title ? { title, needsRefinement: false } : null
}
