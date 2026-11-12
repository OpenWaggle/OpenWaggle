/**
 * Lint config changes that check less (`lint-config`): a rule turned off or down to a warning, a
 * new ignore or exemption entry, a raised limit or a check option turned off, in oxlint.config.mts,
 * .fallowrc.jsonc or doctor.config.ts. Each passes when a comment says why, on the line, above the
 * entry, or above the group of entries it joins, as those files already do; a rule set to error
 * that disappears always blocks. Works on the formatted text, so it reads entries by indentation.
 */
import { type AddedLine, addedLines, removedLines } from './added-lines'
import type { Finding } from './findings'

interface LintConfig {
  /** Keys whose entries exempt code from a check: anything added under them checks less. */
  readonly exemptions: RegExp
  /** Numeric options where a higher value checks less. */
  readonly limits: RegExp
  /** Boolean options and the value at which they check less. */
  readonly looseBooleans: Readonly<Record<string, boolean>>
}

export const LINT_CONFIGS: Readonly<Record<string, LintConfig>> = {
  'oxlint.config.mts': {
    exemptions: /^ignorePatterns$/u,
    limits: /^(?:max\w*|maximum)$/u,
    looseBooleans: { typeAware: false, denyWarnings: false },
  },
  '.fallowrc.jsonc': {
    exemptions:
      /^(?:entry|ignore|ignorePatterns|ignoreDependencies|ignoreDependencyOverrides|ignoreExports|usedClassMembers)$/u,
    limits: /^(?:max\w*|min(?:Tokens|Lines))$/u,
    looseBooleans: { ignoreExportsUsedInFile: true, ignoreLazyImports: true },
  },
  'doctor.config.ts': {
    exemptions: /^ignore$/u,
    limits: /^max\w*$/u,
    looseBooleans: {},
  },
}

/** A rule key set to off or warn: `'rule': 'off'`, `rule: ['warn', ...]`; not `[rule]: 'off'`. */
const LOOSE_SEVERITY = /(?:['"][\w@/-]+['"]|\b[\w$]+)\s*:\s*\[?\s*['"](?:off|warn|allow)['"]/u
const OBJECT_END = /^\s*\}/u
const ERROR_RULE = /['"]?(?<name>[\w@/-]+)['"]?\s*:\s*\[?\s*['"]error['"]/gu
const KEY = /^\s*['"]?(?<key>[\w$@/-]+)['"]?\s*:/u
const NUMBER_OPTION = /['"]?(?<key>\w+)['"]?\s*:\s*(?<value>\d[\d_]*)/gu
const BOOLEAN_OPTION = /['"]?(?<key>\w+)['"]?\s*:\s*(?<value>true|false)\b/gu
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/u
const TRAILING_COMMENT = /[\w'"`,\]}]\s+(?:\/\/|\/\*)\s/u
/** Lines of brackets and commas only, such as an entry's own braces. */
const PUNCTUATION_ONLY = /^[\s()[\]{},]*$/u
const VALUE = /\d[\d_]*|\btrue\b|\bfalse\b/gu
const ENTRY_WINDOW = 30

function indent(text: string) {
  return text.length - text.trimStart().length
}

/** The keys of the entries that enclose line `index`, innermost first. */
function enclosingKeys(lines: readonly string[], index: number) {
  const keys: string[] = []
  let depth = indent(lines[index] ?? '')
  for (let above = index - 1; above >= 0 && depth > 0; above -= 1) {
    const text = lines[above] ?? ''
    if (text.trim() === '' || indent(text) >= depth) continue
    depth = indent(text)
    const key = KEY.exec(text)?.groups?.key
    if (key !== undefined) keys.push(key)
  }
  return keys
}

function numbers(text: string, pattern: RegExp) {
  return new Map(
    [...text.matchAll(pattern)].map((match) => [
      match.groups?.key ?? '',
      match.groups?.value ?? '',
    ]),
  )
}

/** What makes an added line check less, or undefined when it does not. */
function loosening(
  config: LintConfig,
  lines: readonly string[],
  added: AddedLine,
  removed: readonly string[],
) {
  const text = added.text.trim()
  if (COMMENT_LINE.test(text) || PUNCTUATION_ONLY.test(text)) return undefined
  if (LOOSE_SEVERITY.test(text)) return 'rule turned off or down to a warning'
  const exemption = enclosingKeys(lines, added.line - 1).find((key) => config.exemptions.test(key))
  if (exemption !== undefined) return `new entry under ${exemption}`
  const shape = text.replaceAll(VALUE, '#')
  const before = removed.find((line) => line.replaceAll(VALUE, '#') === shape)
  if (before === undefined) return undefined
  const old = numbers(before, NUMBER_OPTION)
  for (const [key, value] of numbers(text, NUMBER_OPTION)) {
    const previous = old.get(key)
    if (config.limits.test(key) && previous !== undefined && toNumber(value) > toNumber(previous)) {
      return `${key} raised from ${previous} to ${value}`
    }
  }
  const flags = numbers(before, BOOLEAN_OPTION)
  for (const [key, value] of numbers(text, BOOLEAN_OPTION)) {
    const loose = config.looseBooleans[key]
    if (loose !== undefined && String(loose) === value && flags.get(key) !== value) {
      return `${key} set to ${value}`
    }
  }
  return undefined
}

function toNumber(value: string) {
  return Number(value.replaceAll('_', ''))
}

/**
 * Whether a comment explains the entry on `line` (1-based): one on the line, above it within its
 * entry or its group of siblings, or directly above the key that holds a list of entries that each
 * have their own reason. The search ends at a blank line or the top level.
 */
interface ScanState {
  readonly depth: number
  /** Past the end of a sibling object: comments above belong to that sibling. */
  readonly pastSibling: boolean
}

/** One line further up: a verdict, or the state to carry on with. */
function scanLine(text: string, previous: string, state: ScanState): boolean | ScanState {
  if (text.trim() === '') return false
  if (COMMENT_LINE.test(text)) return state.pastSibling ? state : true
  const level = indent(text)
  // The top level ends the search; a parent key past a sibling counts only its own comment.
  if (level < state.depth && level === 0) return false
  if (level < state.depth && state.pastSibling) return COMMENT_LINE.test(previous)
  const depth = Math.min(level, state.depth)
  return { depth, pastSibling: state.pastSibling || (level === depth && OBJECT_END.test(text)) }
}

function reasoned(lines: readonly string[], line: number) {
  const own = lines[line - 1] ?? ''
  if (TRAILING_COMMENT.test(own)) return true
  const above = lines.slice(Math.max(0, line - 1 - ENTRY_WINDOW), line - 1)
  let state: ScanState = { depth: indent(own), pastSibling: false }
  for (let index = above.length - 1; index >= 0; index -= 1) {
    const next = scanLine(above[index] ?? '', above[index - 1] ?? '', state)
    if (typeof next === 'boolean') return next
    state = next
  }
  return false
}

function finding(file: string, line: number, message: string): Finding {
  return {
    file,
    line,
    id: 'lint-config',
    message,
  }
}

export function lintConfigFindings(
  file: string,
  before: string | undefined,
  after: string | undefined,
): Finding[] {
  const config = LINT_CONFIGS[file]
  if (config === undefined || before === undefined || after === undefined) return []
  const lines = after.split('\n')
  const added = addedLines(before, after)
  const removed = removedLines(before, after)
  const loose = added.flatMap((entry) => {
    const what = loosening(config, lines, entry, removed)
    return what === undefined || reasoned(lines, entry.line)
      ? []
      : [
          finding(
            file,
            entry.line,
            `${what} with no comment saying why; fix the code, or add the reason above the entry`,
          ),
        ]
  })
  const dropped = [...new Set([...before.matchAll(ERROR_RULE)].map((match) => match[1] ?? ''))]
    .filter((name) => name !== '' && !after.includes(name))
    .map((name) =>
      finding(file, 1, `${name} no longer set to error; keep it, or set it off with the reason`),
    )
  return [...loose, ...dropped]
}
