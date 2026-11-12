/**
 * The renderer-test type ratchet, applied by `scripts/check/typecheck.ts` to the one typecheck pass
 * over every project.
 *
 * Why this exists: renderer tests were compiled with `noCheck`, so a mock whose shape
 * did not match the interface it stood in for compiled silently. One did, and the test
 * passed while asserting against a shape the real component never receives — the wrong
 * mock was invisible precisely because the tests were the one place types were not
 * enforced.
 *
 * Turning checking on surfaced a large pre-existing backlog, so this is not a demand for
 * zero everywhere. It is binary per file: any file NOT on the exemption list must have
 * zero errors, and an exempt file that has become clean fails as a stale exemption so
 * the list can only shrink.
 *
 * Binary rather than a count, because a count-based ratchet is defeated by swapping one
 * error for another: verified while building this, a deliberately wrong mock in a file
 * that already had errors left the total unchanged and passed.
 *
 * Run `bun scripts/check/typecheck.ts --update` after genuinely fixing files.
 */
import path from 'node:path'
import { namedGroups } from '@shared/utils/regex-named-groups'

export const RENDERER_TEST_PROJECT = 'tsconfig.renderer-tests.json'
export const RENDERER_TEST_EXEMPTIONS_FILE = 'scripts/renderer-test-type-exemptions.json'

const ERROR_LINE = /^(?<file>[^(]+)\((?<line>\d+),\d+\): error TS\d+:/u

type ErrorCounts = Readonly<Record<string, number>>

export function countErrorsByFile(output: string): ErrorCounts {
  const counts: Record<string, number> = {}
  for (const rawLine of output.split('\n')) {
    const match = ERROR_LINE.exec(rawLine.trim())
    const file = namedGroups(match, ['file'])?.file
    if (file === undefined) continue
    const normalized = file.split(path.sep).join('/')
    counts[normalized] = (counts[normalized] ?? 0) + 1
  }
  return counts
}

/**
 * A renderer test file, specifically.
 *
 * Scoped to `src/renderer/`: this project references the Node one, whose own test files also appear
 * in its program, so an unscoped count stayed in the hundreds even with every renderer test
 * excluded - measuring the wrong project's health.
 */
export function isRendererTestFile(filePath: string) {
  return filePath.includes('/src/renderer/') && /\.test\.tsx?$/u.test(filePath)
}

/**
 * Options that stop tsc reporting type errors at all.
 *
 * A positive control on the checker itself. Both other tripwires - a non-zero exit with no parseable
 * errors, and a floor on the files pulled into the program - are blind to `noCheck`: with it, tsc
 * exits 0, reports nothing, and still lists every file, so this check printed "all other test files
 * are clean" while checking nothing. That is verbatim the state it was created to prevent, and one
 * line in a tsconfig was enough to reach it.
 */
const OPTIONS_THAT_MUST_BE_OFF = ['noCheck'] as const
/**
 * Options that must stay ON, because switching them off silences the very class of defect this guard
 * exists for: a mock whose shape does not match the interface it stands in for. With `strict` or
 * `strictNullChecks` off, a fixture missing a required field compiles clean and the check still reports
 * every file as clean - the exemption list is empty, so there is no stale-exemption signal either.
 */
const OPTIONS_THAT_MUST_BE_ON = ['strict', 'strictNullChecks', 'noImplicitAny'] as const

/** The compiler options the guard reads; any other option the project sets is not checked. */
type CheckedCompilerOptions = Readonly<
  Partial<
    Record<
      (typeof OPTIONS_THAT_MUST_BE_OFF)[number] | (typeof OPTIONS_THAT_MUST_BE_ON)[number],
      unknown
    >
  >
>

/**
 * Below this, the project is not really checking the renderer tests any more.
 *
 * Well under the real count (about 1,000 renderer test files in November 2026) so ordinary churn
 * never trips it, but far above zero so a project that stopped matching them cannot pass. Counted
 * from the root files tsc resolves from the project's `include` (`--showConfig`), not from git: an
 * `include` that stops matching test files leaves the repository untouched.
 */
export const MINIMUM_RENDERER_TEST_FILES = 100

export interface RendererTestTypeInput {
  /** tsc `--pretty false` output for the run (every project). */
  readonly output: string
  /** Whether the checker exited non-zero. */
  readonly failed: boolean
  /** The renderer-test project's effective compiler options (`--showConfig`). */
  readonly compilerOptions: CheckedCompilerOptions
  /** The renderer-test project's root files (`--showConfig`). */
  readonly rootFiles: readonly string[]
  readonly exemptions: readonly string[]
}

export interface RendererTestTypeVerdict {
  readonly ok: boolean
  /** Lines to print: findings and what to do about them. */
  readonly messages: readonly string[]
  /** Files with errors, for `--update`. */
  readonly failingFiles: readonly string[]
  /** Error lines outside exempt files. */
  readonly reportedErrors: readonly string[]
}

function failure(messages: readonly string[], failingFiles: readonly string[] = []) {
  return { ok: false, messages, failingFiles, reportedErrors: [] }
}

/** A tsconfig option that would let the check pass while checking nothing. */
function compilerOptionFailure(options: CheckedCompilerOptions) {
  const disabled = OPTIONS_THAT_MUST_BE_OFF.filter((option) => options[option] === true)
  if (disabled.length > 0) {
    return `${RENDERER_TEST_PROJECT} enables ${disabled.join(', ')}, so tsc reports no type errors at all and this check would pass while checking nothing. Remove it.`
  }
  const relaxed = OPTIONS_THAT_MUST_BE_ON.filter((option) => options[option] === false)
  if (relaxed.length > 0) {
    return `${RENDERER_TEST_PROJECT} turns off ${relaxed.join(', ')}. A fixture missing a required field then compiles clean, which is exactly the mismatch this check exists to catch. Restore it.`
  }
  return undefined
}

/** Error lines outside exempt files, deduplicated (a file in two projects reports twice). */
function errorsOutsideExemptions(output: string, exempt: ReadonlySet<string>) {
  const reported = new Map<string, string>()
  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trim()
    const file = namedGroups(ERROR_LINE.exec(line), ['file'])?.file?.split(path.sep).join('/')
    if (file !== undefined && !exempt.has(file)) reported.set(line, file)
  }
  return reported
}

function countRendererTestFiles(rootFiles: readonly string[]) {
  return rootFiles.filter((file) => isRendererTestFile(`/${file.replace(/^\.\//u, '')}`)).length
}

/**
 * Applies the guards and the ratchet: every error outside an exempt renderer test file fails, an
 * exempt file that is clean fails as stale, and a run that could not have checked the renderer
 * tests fails even when it reports nothing.
 */
export function evaluateRendererTestTypes(input: RendererTestTypeInput): RendererTestTypeVerdict {
  const optionFailure = compilerOptionFailure(input.compilerOptions)
  if (optionFailure !== undefined) return failure([optionFailure])

  const counts = countErrorsByFile(input.output)
  const failingFiles = Object.keys(counts).sort()
  if (input.failed && failingFiles.length === 0) {
    return failure([
      'The typechecker failed but reported no file-scoped type errors, so this run checked nothing. Raw output:',
      input.output.trim() || '(no output)',
    ])
  }

  const testFileCount = countRendererTestFiles(input.rootFiles)
  if (testFileCount < MINIMUM_RENDERER_TEST_FILES) {
    return failure([
      `${RENDERER_TEST_PROJECT} includes only ${String(testFileCount)} renderer test file(s), below the floor of ${String(MINIMUM_RENDERER_TEST_FILES)}. Its include has stopped matching the renderer tests, so this guard is checking almost nothing.`,
    ])
  }

  const reported = errorsOutsideExemptions(input.output, new Set(input.exemptions))
  if (reported.size > 0) {
    const rendererTestErrors = [...reported.values()].some((file) => isRendererTestFile(`/${file}`))
    return {
      ok: false,
      failingFiles,
      reportedErrors: [...reported.keys()],
      messages: rendererTestErrors
        ? [
            'Renderer test fixtures must match the interfaces they stand in for. Do not silence a mismatch with fromPartial: it casts.',
          ]
        : [],
    }
  }

  const stale = input.exemptions.filter((file) => counts[file] === undefined)
  if (stale.length > 0) {
    return failure(
      [
        ...stale.map(
          (file) =>
            `${file}:1:1 stale-exemption now clean; remove it from ${RENDERER_TEST_EXEMPTIONS_FILE}`,
        ),
        'Run: bun scripts/check/typecheck.ts --update',
      ],
      failingFiles,
    )
  }
  return { ok: true, messages: [], failingFiles, reportedErrors: [] }
}
