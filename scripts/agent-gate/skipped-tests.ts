/**
 * Tests skipped or deleted to get a change through (GATE-03): a new `.skip`, `.only`, `.todo`,
 * `xit` or `fit` in a test file, a `skipIf` or `runIf` with no comment above it saying when it
 * runs, and a deleted test file whose subject still exists. A deleted test whose subject is gone went with its code; one with no recognisable subject
 * passes only when the change also added a test file, as a move or rename does.
 */
import { addedLines } from './added-lines'
import type { Finding } from './findings'

const TEST_FILE = /(?:^|\/)__tests__\/.*\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$/u
/** Files that name the modifiers on purpose: the checks that look for them and their tests. */
const EXEMPT_FILE = /^(?:scripts\/oxlint\/|scripts\/agent-gate\/)/u
const SKIP =
  /\.(?<modifier>skip|only|todo|skipIf|runIf)\s*\(|\b(?<prefixed>xit|xtest|xdescribe|fit|fdescribe)\s*\(/u
const TEST_SUFFIX =
  /(?:\.(?:unit|integration|component|e2e|browser))?\.(?:test|spec)\.[cm]?[jt]sx?$/u
const SUBJECT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '/index.ts']

/** Conditional skips, such as a test of a build artifact that only runs after the build. */
const CONDITIONAL = new Set(['skipIf', 'runIf'])
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/u

function commentAbove(lines: readonly string[], line: number) {
  const above = lines.slice(0, line - 1).findLast((text) => text.trim() !== '')
  return above !== undefined && COMMENT_LINE.test(above)
}

export function isTestFile(file: string) {
  return TEST_FILE.test(file)
}

/** Where the code a test file covers would live: `a/__tests__/b.unit.test.ts` covers `a/b.ts`. */
export function testSubjects(file: string) {
  if (!TEST_SUFFIX.test(file)) return []
  const base = file
    .replace(TEST_SUFFIX, '')
    .replace(/(?:^|\/)__tests__\//u, (match) => (match.startsWith('/') ? '/' : ''))
  return SUBJECT_EXTENSIONS.map((extension) => `${base}${extension}`)
}

function finding(file: string, message: string, line?: number): Finding {
  return {
    file,
    ...(line === undefined ? {} : { line }),
    rule: 'gate/tests',
    id: 'GATE-03',
    message,
    severity: 'block',
  }
}

/** New skip and focus modifiers in one changed test file. */
export function skippedTestFindings(
  file: string,
  before: string | undefined,
  after: string | undefined,
): Finding[] {
  if (after === undefined || !isTestFile(file) || EXEMPT_FILE.test(file)) return []
  const lines = after.split('\n')
  return addedLines(before, after).flatMap((added) => {
    const groups = SKIP.exec(added.text)?.groups
    const modifier = groups?.['modifier'] ?? groups?.['prefixed']
    if (modifier === undefined) return []
    if (CONDITIONAL.has(modifier) && commentAbove(lines, added.line)) return []
    const how = CONDITIONAL.has(modifier)
      ? 'with no comment above saying when it runs'
      : 'run it and fix what fails'
    return [finding(file, `new ${modifier} on a test; ${how}`, added.line)]
  })
}

export interface FileState {
  readonly file: string
  readonly existedBefore: boolean
  readonly existsNow: boolean
}

/**
 * Deleted test files whose code is still there. `exists` answers for the current tree, and
 * `existed` for the baseline.
 */
export async function deletedTestFindings(
  changes: readonly FileState[],
  exists: (file: string) => Promise<boolean>,
  existed: (file: string) => Promise<boolean>,
): Promise<Finding[]> {
  const tests = changes.filter((change) => isTestFile(change.file))
  const addedTest = tests.some((change) => change.existsNow && !change.existedBefore)
  const deleted = tests.filter((change) => change.existedBefore && !change.existsNow)
  const found = await Promise.all(
    deleted.map(async ({ file }) => {
      const subjects = testSubjects(file)
      const [now, then] = await Promise.all([
        Promise.all(subjects.map(exists)),
        Promise.all(subjects.map(existed)),
      ])
      const subject = subjects.find((_, index) => now[index] === true)
      if (subject !== undefined) {
        return [finding(file, `deleted while ${subject} still exists; restore the test`)]
      }
      const known = then.some(Boolean)
      return known || addedTest
        ? []
        : [finding(file, 'test file deleted without the code it covers; restore it')]
    }),
  )
  return found.flat()
}
