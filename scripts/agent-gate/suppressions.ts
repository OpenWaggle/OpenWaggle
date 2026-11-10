/**
 * New inline suppressions (TS-08): lint and type-check directive comments that a Session added,
 * compared with the same file when the Session started. Existing ones are left to the lint rules;
 * the gate only stops new ones from slipping in, including in files lint does not cover.
 */
import type { Finding } from './findings'

const CODE_FILE = /\.(?:[cm]?[jt]sx?|astro|vue|svelte|css|scss|html)$/u
/** Files that name the directives on purpose: the rules that ban them and their tests. */
const EXEMPT_FILE = /^(?:scripts\/oxlint\/|scripts\/agent-gate\/|scripts\/standards\/)/u
const DIRECTIVE =
  /(?:\/\/|\/\*|^\s*\*|<!--|\{\/\*)\s*(?<directive>eslint-disable(?:-next-line|-line)?|eslint-enable|oxlint-disable(?:-next-line|-line)?|oxlint-enable|biome-ignore(?:-all|-start|-end)?|fallow-ignore(?:-next-line|-file)?|@ts-ignore|@ts-expect-error|@ts-nocheck)\b/u

export interface Suppression {
  readonly line: number
  readonly column: number
  readonly directive: string
  readonly text: string
}

export function isSuppressionCandidate(file: string) {
  return CODE_FILE.test(file) && !EXEMPT_FILE.test(file)
}

export function suppressions(text: string): Suppression[] {
  return text.split('\n').flatMap((line, index) => {
    const match = DIRECTIVE.exec(line)
    const directive = match?.groups?.['directive']
    if (match === null || directive === undefined) return []
    return [{ line: index + 1, column: match.index + 1, directive, text: line.trim() }]
  })
}

/** Suppressions in `after` beyond those `before` had, matched by their line text. */
export function newSuppressions(
  file: string,
  before: string | undefined,
  after: string,
): Finding[] {
  if (!isSuppressionCandidate(file)) return []
  const remaining = new Map<string, number>()
  for (const existing of suppressions(before ?? '')) {
    remaining.set(existing.text, (remaining.get(existing.text) ?? 0) + 1)
  }
  return suppressions(after).flatMap((suppression) => {
    const left = remaining.get(suppression.text) ?? 0
    if (left > 0) {
      remaining.set(suppression.text, left - 1)
      return []
    }
    return [
      {
        file,
        line: suppression.line,
        column: suppression.column,
        rule: 'gate/suppressions',
        id: 'TS-08',
        message: `new ${suppression.directive} comment; fix the code or the shared config instead`,
        severity: 'block' as const,
      },
    ]
  })
}
