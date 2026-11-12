/**
 * Tests skipped or deleted to get a change through (`test`): a new `.skip`, `.only`, `.todo`,
 * `xit` or `fit` in a test file, a `skipIf` or `runIf` with no comment above it saying when it
 * runs, and a deleted test file whose subject still exists or cannot be told. A test deleted
 * with its code (its subject, or code beside it), one git sees as moved, or one merged into a
 * test file that the same change edits and that imports the subject, passes.
 */
import path from 'node:path'
import { addedLines } from './added-lines'
import type { Finding } from './findings'

const TEST_FILE = /(?:^|\/)__tests__\/.*\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$/u
/** Files that name the modifiers on purpose: the checks that look for them and their tests. */
const EXEMPT_FILE = /^(?:scripts\/oxlint\/|scripts\/no-cheating\/)/u
const SKIP =
  /\.(?<modifier>skip|only|todo|skipIf|runIf)\s*\(|\b(?<prefixed>xit|xtest|xdescribe|fit|fdescribe)\s*\(/u
const TEST_SUFFIX =
  /(?:\.(?:unit|integration|component|e2e|browser))?\.(?:test|spec)\.[cm]?[jt]sx?$/u
const SUBJECT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '/index.ts']
const MODULE_EXTENSION = /(?:\/index)?\.[cm]?[jt]sx?$/u
const SPECIFIER = /(?:\bfrom|\bimport\s*\(|\bmock\s*\(|\bimport)\s*['"](?<specifier>[^'"]+)['"]/gu
/** Path aliases the tsconfigs declare, as repository paths. */
const ALIASES: readonly (readonly [string, string])[] = [
  ['@/', 'src/renderer/src/'],
  ['@shared/', 'src/shared/'],
]

/** Conditional skips, such as a test of a build artifact that only runs after the build. */
const CONDITIONAL = new Set(['skipIf', 'runIf'])
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/u

function commentAbove(lines: readonly string[], line: number) {
  const above = lines.slice(0, line - 1).findLast((text) => text.trim() !== '')
  return above !== undefined && COMMENT_LINE.test(above)
}

/** The directory of the code a test file covers: the parent of its `__tests__` folder. */
function codeDirectory(file: string) {
  const directory = path.posix.dirname(file)
  return `${path.posix.basename(directory) === '__tests__' ? path.posix.dirname(directory) : directory}/`
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
    id: 'test',
    message,
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

export interface DeletedTestInput {
  readonly changes: readonly FileState[]
  /** Test files git sees as moved or renamed to another file; their tests live on. */
  readonly moved: ReadonlySet<string>
  /** Whether a file exists now. */
  readonly exists: (file: string) => Promise<boolean>
  /** Whether a file existed at the base. */
  readonly existed: (file: string) => Promise<boolean>
  /** A file's current text, or undefined when it cannot be read. */
  readonly textNow: (file: string) => Promise<string | undefined>
}

/** The repository path, without extension, that an import specifier in `file` names. */
function resolvedModule(file: string, specifier: string) {
  const alias = ALIASES.find(([prefix]) => specifier.startsWith(prefix))
  if (alias !== undefined) return `${alias[1]}${specifier.slice(alias[0].length)}`
  if (!specifier.startsWith('.')) return undefined
  return path.posix.join(path.posix.dirname(file), specifier)
}

function importsModule(file: string, text: string, subject: string) {
  const target = subject.replace(MODULE_EXTENSION, '')
  for (const match of text.matchAll(SPECIFIER)) {
    const specifier = match.groups?.['specifier']
    const resolved = specifier === undefined ? undefined : resolvedModule(file, specifier)
    if (resolved?.replace(MODULE_EXTENSION, '') === target) return true
  }
  return false
}

/** Test files this change added or edited that import `subject`: where merged tests went. */
async function receivingTestFile(input: DeletedTestInput, subject: string) {
  const candidates = input.changes.filter(
    (change) => change.existsNow && TEST_SUFFIX.test(change.file),
  )
  const texts = await Promise.all(candidates.map((change) => input.textNow(change.file)))
  return candidates.find((change, index) => {
    const text = texts[index]
    return text !== undefined && importsModule(change.file, text, subject)
  })?.file
}

/**
 * Deleted test files whose code is still there, or whose code cannot be told and that did not
 * move. A test deleted together with its code, moved to another file, or merged into a test file
 * the same change edits and that imports the code, passes.
 */
export async function deletedTestFindings(input: DeletedTestInput): Promise<Finding[]> {
  const { exists, existed } = input
  const deletedCode = input.changes
    .filter((change) => change.existedBefore && !change.existsNow && !isTestFile(change.file))
    .map((change) => change.file)
  const deleted = input.changes.filter(
    (change) =>
      // Helpers under __tests__ go with the tests that use them; only test files count.
      TEST_SUFFIX.test(change.file) &&
      change.existedBefore &&
      !change.existsNow &&
      !input.moved.has(change.file),
  )
  const found = await Promise.all(
    deleted.map(async ({ file }) => {
      const subjects = testSubjects(file)
      const [now, then] = await Promise.all([
        Promise.all(subjects.map(exists)),
        Promise.all(subjects.map(existed)),
      ])
      const subject = subjects.find((_, index) => now[index] === true)
      if (subject !== undefined) {
        if ((await receivingTestFile(input, subject)) !== undefined) return []
        return [
          finding(
            file,
            `deleted while ${subject} still exists; restore the test, or merge its cases into a test file that imports it`,
          ),
        ]
      }
      // No subject by name: the test went with its code when code beside it was deleted too.
      const known =
        then.some(Boolean) || deletedCode.some((code) => code.startsWith(codeDirectory(file)))
      return known
        ? []
        : [finding(file, 'test file deleted without the code it covers; restore it')]
    }),
  )
  return found.flat()
}
