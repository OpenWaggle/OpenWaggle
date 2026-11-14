/**
 * The test tiers' reporter: one line when every test passes, and for each failure only its
 * `file:line:col`, the test's name and the start of the error. Agents read this output, so every
 * passing test, file and console line it leaves out is tokens not spent.
 *
 * Console output from a test is kept and printed only when that test fails (capped). Pass
 * `--reporter=default` to see Vitest's usual output.
 */
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import type { UserConsoleLog } from 'vitest'
import type { Reporter, SerializedError, TestCase, TestModule, TestRunEndReason } from 'vitest/node'

const MESSAGE_LINES = 6
const DIFF_LINES = 12
const CONSOLE_LINES = 20
const MILLISECONDS_PER_SECOND = 1000

interface Counts {
  passed: number
  failed: number
  skipped: number
}

function relative(file: string) {
  return path.relative(process.cwd(), file).split(path.sep).join('/')
}

function firstLines(text: string, count: number) {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim() !== '')
  const shown = lines.slice(0, count)
  if (lines.length > count) shown.push(`... ${lines.length - count} more lines`)
  return shown
}

/** Prefer the frame in the failing test file, then any frame outside node_modules. */
function errorLocation(error: SerializedError, moduleFile: string) {
  const frames = error.stacks ?? []
  const frame =
    frames.find((candidate) => candidate.file === moduleFile) ??
    frames.find((candidate) => !candidate.file.includes('node_modules'))
  return frame
}

function formatError(error: SerializedError, moduleFile: string, title: string) {
  const location = errorLocation(error, moduleFile)
  const where =
    location === undefined
      ? `${relative(moduleFile)}:1:1`
      : `${relative(location.file)}:${location.line}:${location.column}`
  const name = error.name !== undefined && error.name !== 'Error' ? `${error.name}: ` : ''
  const lines = [`${where} FAIL ${title}`]
  for (const line of firstLines(`${name}${error.message}`, MESSAGE_LINES)) lines.push(`  ${line}`)
  // `diff` is not a declared SerializedError field; an assertion error carries it.
  const fields: object = error
  const diff = 'diff' in fields && typeof fields.diff === 'string' ? fields.diff : ''
  for (const line of firstLines(diff, DIFF_LINES)) lines.push(`  ${line}`)
  return lines
}

export default class CompactReporter implements Reporter {
  private started = performance.now()
  private readonly consoleByTask = new Map<string, string[]>()

  onTestRunStart() {
    this.started = performance.now()
    this.consoleByTask.clear()
  }

  onUserConsoleLog(log: UserConsoleLog) {
    if (log.taskId === undefined) return
    const lines = this.consoleByTask.get(log.taskId) ?? []
    if (lines.length < CONSOLE_LINES) lines.push(...firstLines(log.content, CONSOLE_LINES))
    this.consoleByTask.set(log.taskId, lines.slice(0, CONSOLE_LINES))
  }

  onTestRunEnd(
    testModules: readonly TestModule[],
    unhandledErrors: readonly SerializedError[],
    reason: TestRunEndReason,
  ) {
    const output: string[] = []
    const counts: Counts = { passed: 0, failed: 0, skipped: 0 }
    for (const testModule of testModules) {
      const moduleFile = testModule.moduleId
      for (const error of testModule.errors()) {
        output.push(...formatError(error, moduleFile, `${relative(moduleFile)} (file failed)`))
        counts.failed += 1
      }
      for (const test of testModule.children.allTests()) {
        output.push(...this.testOutput(test, moduleFile, counts))
      }
    }
    for (const error of unhandledErrors) {
      output.push(...formatError(error, '', 'unhandled error'))
    }

    output.push(
      this.summary(reason, output.length === 0, counts, testModules.length, unhandledErrors.length),
    )
    process.stdout.write(`${output.join('\n')}\n`)
  }

  private summary(
    reason: TestRunEndReason,
    green: boolean,
    counts: Counts,
    fileCount: number,
    unhandled: number,
  ) {
    const seconds = ((performance.now() - this.started) / MILLISECONDS_PER_SECOND).toFixed(1)
    if (reason === 'interrupted') return `vitest: interrupted after ${seconds}s`
    const skipped = counts.skipped > 0 ? `, ${counts.skipped} skipped` : ''
    const files = `${fileCount} files`
    if (green) return `vitest: ${counts.passed} tests in ${files} passed${skipped} in ${seconds}s`
    const errors = unhandled > 0 ? `, ${unhandled} unhandled errors` : ''
    return `vitest: ${counts.failed} failed, ${counts.passed} passed${skipped}${errors} (${files}, ${seconds}s)`
  }

  private testOutput(test: TestCase, moduleFile: string, counts: Counts) {
    const result = test.result()
    if (result.state === 'passed') counts.passed += 1
    if (result.state === 'skipped') counts.skipped += 1
    if (result.state !== 'failed') return []
    counts.failed += 1
    const lines = result.errors.flatMap((error) => formatError(error, moduleFile, test.fullName))
    const logs = this.consoleByTask.get(test.id) ?? []
    if (logs.length > 0) lines.push('  console:', ...logs.map((line) => `    ${line}`))
    return lines
  }
}
