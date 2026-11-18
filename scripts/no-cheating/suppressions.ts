/**
 * New inline suppressions (`suppression`) and silencing casts (`cast`): lint and type-check
 * directive comments, `as any`, `as unknown as` and `as never` that a change added, compared with
 * the same file at the base commit. Existing ones are left to the lint rules; the gate only stops new
 * ones from slipping in, including in files lint does not cover or still exempts.
 */
import { addedLines } from './added-lines'
import type { Finding } from './findings'
import { namedGroups } from '@shared/utils/regex-named-groups'

const CODE_FILE = /\.(?:[cm]?[jt]sx?|astro|vue|svelte|css|scss|html)$/u
/** Files that name the directives on purpose: the rules that ban them and their tests. */
const EXEMPT_FILE = /^(?:scripts\/oxlint\/|scripts\/no-cheating\/|scripts\/standards\/)/u
const DIRECTIVE =
  /(?:\/\/|\/\*|^\s*\*|<!--|\{\/\*)\s*(?<directive>eslint-disable(?:-next-line|-line)?|eslint-enable|oxlint-disable(?:-next-line|-line)?|oxlint-enable|biome-ignore(?:-all|-start|-end)?|fallow-ignore(?:-next-line|-file)?|@ts-ignore|@ts-expect-error|@ts-nocheck)\b/u

const TYPESCRIPT_FILE = /\.(?:[cm]?tsx?|astro|vue|svelte)$/u
const SILENCING_CAST = /\bas\s+(?<cast>any|never|unknown\s+as)\b/u

export interface Suppression {
  readonly line: number
  readonly column: number
  readonly directive: string
  readonly text: string
}

export function isSuppressionCandidate(file: string) {
  return CODE_FILE.test(file) && !EXEMPT_FILE.test(file)
}

export function suppressions(text: string) {
  const suppression: Suppression[] = text.split('\n').flatMap((line, index) => {
    const match = DIRECTIVE.exec(line)
    const directive = namedGroups(match, ['directive'])?.directive
    if (match === null || directive === undefined) return []
    return [{ line: index + 1, column: match.index + 1, directive, text: line.trim() }]
  })
  return suppression
}

/** Suppressions in `after` beyond those `before` had, matched by their line text. */
export function newSuppressions(file: string, before: string | undefined, after: string) {
  if (!isSuppressionCandidate(file)) {
    const finding: Finding[] = []
    return finding
  }
  const remaining = new Map<string, number>()
  for (const existing of suppressions(before ?? '')) {
    remaining.set(existing.text, (remaining.get(existing.text) ?? 0) + 1)
  }
  const directives = suppressions(after).flatMap<Finding>((suppression) => {
    const left = remaining.get(suppression.text) ?? 0
    if (left > 0) {
      remaining.set(suppression.text, left - 1)
      return []
    }
    return [
      {
        file,
        line: suppression.line,
        id: 'suppression',
        message: `new ${suppression.directive} comment; fix the code or the shared config instead`,
      },
    ]
  })
  const finding: Finding[] = [...directives, ...silencingCasts(file, before, after)]
  return finding
}

/** Casts that turn the type checker off for a value, added since `before`. */
function silencingCasts(file: string, before: string | undefined, after: string) {
  if (!TYPESCRIPT_FILE.test(file)) {
    const finding: Finding[] = []
    return finding
  }
  return addedLines(before, after).flatMap<Finding>((added) => {
    const match = SILENCING_CAST.exec(added.text)
    const cast = namedGroups(match, ['cast'])?.cast
    if (match === null || cast === undefined) return []
    return [
      {
        file,
        line: added.line,
        id: 'cast',
        message: `new \`as ${cast.replaceAll(/\s+/gu, ' ')}\` cast; type the value instead`,
      },
    ]
  })
}
