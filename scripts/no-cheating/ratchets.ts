/**
 * Budgets, caps and ratchets that may only tighten, and lists that may only shrink (GATE-05 and
 * the rules that own each list). A raised bundle, output-token, first-turn prefix, memory or rule
 * catalogue budget, a lowered coverage threshold, or a new entry in an exemption list blocks with
 * no way out but getting under the limit: none of these files takes a reason in place of the fix.
 */
import type { Finding } from './findings'

type Direction = 'higher' | 'lower'

interface Budget {
  readonly name: string
  readonly files: RegExp
  /** The numeric keys that are budgets; JSON keys are dotted paths. */
  readonly keys: RegExp
  /** Which way a change checks less. */
  readonly looser: Direction
}

interface ShrinkingList {
  readonly name: string
  readonly id: string
  readonly files: RegExp
  /** For TypeScript files: the declaration whose string literals are the list. */
  readonly declaration?: string
}

export const BUDGETS: readonly Budget[] = [
  {
    name: 'check output budget',
    files: /^scripts\/check\/output-budget\.json$/u,
    keys: /./u,
    looser: 'higher',
  },
  {
    name: 'bundle budget',
    files: /^scripts\/(?:check-syntax-bundle|check-main-bundle|main-bundle-graph)\.ts$/u,
    keys: /^(?:MAX_\w+|\w*BUDGET\w*|maximumBytes)$/u,
    looser: 'higher',
  },
  {
    name: 'first-turn prefix budget',
    files: /^scripts\/perf\/first-turn-prefix\/first-turn-prefix-budget\.ts$/u,
    keys: /^[a-z]+$/u,
    looser: 'higher',
  },
  {
    name: 'token cap',
    files: /^scripts\/standards\/[\w-]+\.ts$/u,
    keys: /_CAP$/u,
    looser: 'higher',
  },
  {
    name: 'coverage threshold',
    files: /^vitest(?:\.[\w-]+)?\.config\.m?ts$/u,
    keys: /^(?:lines|functions|statements|branches)$/u,
    looser: 'lower',
  },
  {
    name: 'syntax performance budget',
    files: /^performance\/syntax-budgets\/[\w-]+\.json$/u,
    keys: /BudgetsMs\./u,
    looser: 'higher',
  },
]

export const SHRINKING_LISTS: readonly ShrinkingList[] = [
  {
    name: 'design token exemptions',
    id: 'REACT-06',
    files: /^scripts\/renderer-design-token-exemptions\.json$/u,
  },
  {
    name: 'renderer test type exemptions',
    id: 'GATE-05',
    files: /^scripts\/renderer-test-type-exemptions\.json$/u,
  },
  {
    name: 'legacy shared ADR numbers',
    id: 'DOC-05',
    files: /^scripts\/standards\/adr-numbering\.ts$/u,
    declaration: 'LEGACY_SHARED_ADR_NUMBERS',
  },
]

const TS_NUMBER =
  /(?<key>[A-Za-z_$][\w$]*)\s*[:=]\s*(?<value>\d[\d_]*(?:\.\d+)?)(?:\s*\*\s*(?<factor>\d[\d_]*))?/gu
/** Grown list entries named in one finding. */
const SHOWN_ENTRIES = 3
const STRING_LITERAL = /'(?<value>[^'\n]+)'|"(?<double>[^"\n]+)"/gu

/** Numeric leaves by key; a repeated key gets `#n` so each occurrence compares with its own. */
function numericEntries(file: string, text: string): Map<string, number> {
  const entries = new Map<string, number>()
  if (file.endsWith('.json')) {
    const visit = (prefix: string, value: unknown) => {
      if (typeof value === 'number') entries.set(prefix, value)
      if (value === null || typeof value !== 'object') return
      for (const [key, child] of Object.entries(value)) {
        visit(prefix === '' ? key : `${prefix}.${key}`, child)
      }
    }
    visit('', parseJson(text))
    return entries
  }
  const seen = new Map<string, number>()
  for (const match of text.matchAll(TS_NUMBER)) {
    const key = match.groups?.['key'] ?? ''
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    const value = Number((match.groups?.['value'] ?? '').replaceAll('_', ''))
    const factor = Number((match.groups?.['factor'] ?? '1').replaceAll('_', ''))
    entries.set(count === 1 ? key : `${key}#${count}`, value * factor)
  }
  return entries
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** A list's entries: JSON leaves as `path=value` (counts as numbers), TS string literals. */
function listEntries(list: ShrinkingList, text: string): Map<string, number> {
  const entries = new Map<string, number>()
  if (list.declaration !== undefined) {
    const start = text.indexOf(list.declaration)
    if (start < 0) return entries
    const end = text.indexOf('])', start)
    for (const match of text.slice(start, end < 0 ? undefined : end).matchAll(STRING_LITERAL)) {
      entries.set(match.groups?.['value'] ?? match.groups?.['double'] ?? '', 1)
    }
    return entries
  }
  const visit = (prefix: string, value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(`${prefix}[${JSON.stringify(item)}]`, undefined)
      return
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) visit(`${prefix}/${key}`, child)
      return
    }
    entries.set(prefix, typeof value === 'number' ? value : 1)
  }
  visit('', parseJson(text))
  return entries
}

function finding(file: string, id: string, message: string): Finding {
  return { file, id, message }
}

function budgetFindings(file: string, before: string, after: string): Finding[] {
  return BUDGETS.filter((budget) => budget.files.test(file)).flatMap((budget) => {
    const old = numericEntries(file, before)
    return [...numericEntries(file, after)].flatMap(([key, value]) => {
      const previous = old.get(key)
      if (!budget.keys.test(key) || previous === undefined || previous === value) return []
      const looser = budget.looser === 'higher' ? value > previous : value < previous
      return looser
        ? [
            finding(
              file,
              'GATE-05',
              `${budget.name} ${key} moved from ${previous} to ${value}; get under it instead`,
            ),
          ]
        : []
    })
  })
}

function listFindings(file: string, before: string, after: string): Finding[] {
  return SHRINKING_LISTS.filter((list) => list.files.test(file)).flatMap((list) => {
    const old = listEntries(list, before)
    const grown = [...listEntries(list, after)]
      .filter(([key, value]) => value > (old.get(key) ?? 0))
      .map(([key]) => key)
    if (grown.length === 0) return []
    const shown = grown.slice(0, SHOWN_ENTRIES).join(', ')
    const more = grown.length > SHOWN_ENTRIES ? ` and ${grown.length - SHOWN_ENTRIES} more` : ''
    return [
      finding(file, list.id, `${list.name} only shrink; new ${shown}${more}; fix the code instead`),
    ]
  })
}

/** Raised budgets and grown lists in one changed file; a new or deleted file is left to review. */
export function ratchetFindings(
  file: string,
  before: string | undefined,
  after: string | undefined,
): Finding[] {
  if (before === undefined || after === undefined) return []
  return [...budgetFindings(file, before, after), ...listFindings(file, before, after)]
}
