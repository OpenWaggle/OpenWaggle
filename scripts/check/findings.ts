/**
 * Turns a failed step's log into the lines an agent needs: one finding per line, or the end of the
 * log when the tool printed nothing recognisable.
 */
import { stripVTControlCharacters } from 'node:util'
import type { FindingFormat } from './step-model'

/** At most this many findings per step are printed; the log keeps the rest. */
export const MAX_PRINTED_FINDINGS = 40
/** Log lines shown for a failure with no recognisable findings. */
export const FALLBACK_TAIL_LINES = 25

const TSC_ERROR =
  /^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\): error (?<code>TS\d+): (?<message>.*)$/u
/** `path:line` or `path:line:col` at the start of a line, the shape most tools print. */
const LOCATED_LINE = /^[^\s:]+:\d+(?::\d+)?(?:[:\s]|$)/u
/** A line that states the error itself (`error: ...`, `Error: ...`, `TypeError: ...`). */
const ERROR_LINE = /^\s*(?:[A-Z]\w*)?(?:error|Error|ERROR)\b:?\s/u
/** Error lines beyond this are noise (a stack of rethrows); the tail is shown instead. */
const MAX_ERROR_LINES = 10

function logLines(log: string) {
  // Some tools colour their output even with NO_COLOR set.
  return stripVTControlCharacters(log)
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
}

function tail(lines: readonly string[]) {
  return lines.filter((line) => line.trim() !== '').slice(-FALLBACK_TAIL_LINES)
}

/** `file(line,col): error TS1: message` -> `file:line:col TS1 message`. */
export function compactTscLine(line: string) {
  const groups = TSC_ERROR.exec(line.trim())?.groups
  if (groups === undefined) return undefined
  const { file, line: lineNumber, column, code, message } = groups
  return `${String(file)}:${String(lineNumber)}:${String(column)} ${String(code)} ${String(message)}`
}

export function parseFindings(format: FindingFormat, log: string): readonly string[] {
  const lines = logLines(log)
  const nonEmpty = lines.filter((line) => line.trim() !== '')
  if (format === 'lines' || format === 'vitest') {
    return nonEmpty.length > 0 ? nonEmpty : tail(lines)
  }
  if (format === 'tsc') {
    const findings = nonEmpty.flatMap((line) => compactTscLine(line) ?? [])
    return findings.length > 0 ? findings : tail(lines)
  }
  const located = nonEmpty.filter((line) => LOCATED_LINE.test(line))
  if (located.length > 0) return located
  const errors = nonEmpty.filter((line) => ERROR_LINE.test(line))
  return errors.length > 0 && errors.length <= MAX_ERROR_LINES ? errors : tail(lines)
}

/** Caps the findings and says where the rest are. */
export function capFindings(findings: readonly string[], logPath: string) {
  if (findings.length <= MAX_PRINTED_FINDINGS) return findings
  const hidden = findings.length - MAX_PRINTED_FINDINGS
  return [...findings.slice(0, MAX_PRINTED_FINDINGS), `... ${hidden} more in ${logPath}`]
}
