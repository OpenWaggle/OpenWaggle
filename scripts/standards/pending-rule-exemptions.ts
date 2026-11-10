import { readFileSync } from 'node:fs'
import type { Violation } from './violation'

const EXEMPTIONS_URL = new URL('../oxlint/pending-rule-exemptions.json', import.meta.url)
const EXEMPTIONS_FILE = 'scripts/oxlint/pending-rule-exemptions.json'
const PENDING_SOURCE_FILE = /^src\/.+\.tsx?$/u

/** Adopted lint rules mapped to the files that still break them, with their finding counts. */
export type PendingRuleExemptions = Readonly<Record<string, Readonly<Record<string, unknown>>>>

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readPendingRuleExemptions(): PendingRuleExemptions {
  const parsed: unknown = JSON.parse(readFileSync(EXEMPTIONS_URL, 'utf8'))
  if (!isRecord(parsed)) {
    throw new Error(`${EXEMPTIONS_FILE} must map rules to files`)
  }
  const exemptions: Record<string, Readonly<Record<string, unknown>>> = {}
  for (const [rule, files] of Object.entries(parsed)) {
    if (!isRecord(files)) {
      throw new Error(`${EXEMPTIONS_FILE}: ${rule} must map files to finding counts`)
    }
    exemptions[rule] = files
  }
  return exemptions
}

function isSorted(values: readonly string[]) {
  return values.every((value, index) => index === 0 || (values[index - 1] ?? '') < value)
}

/**
 * The pending list only shrinks: every entry names an existing src file with a positive finding
 * count, in sorted order, so a fixed or deleted file shows up as an entry to remove.
 */
export function collectPendingRuleExemptionViolations(
  repositoryFiles: ReadonlySet<string>,
  exemptions: PendingRuleExemptions,
): readonly Violation[] {
  const violations: Violation[] = []
  if (!isSorted(Object.keys(exemptions))) {
    violations.push({ file: EXEMPTIONS_FILE, message: 'Pending lint rules must be sorted.' })
  }
  for (const [rule, files] of Object.entries(exemptions)) {
    const paths = Object.keys(files)
    if (paths.length === 0) {
      violations.push({
        file: EXEMPTIONS_FILE,
        message: 'Remove a pending lint rule with no files left.',
        detail: rule,
      })
    }
    if (!isSorted(paths)) {
      violations.push({
        file: EXEMPTIONS_FILE,
        message: 'Pending lint rule files must be sorted.',
        detail: rule,
      })
    }
    for (const [file, count] of Object.entries(files)) {
      if (!PENDING_SOURCE_FILE.test(file)) {
        violations.push({
          file: EXEMPTIONS_FILE,
          message: 'Pending lint rule files must be repository-relative src TS/TSX paths.',
          detail: `${rule}: ${file}`,
        })
      }
      if (PENDING_SOURCE_FILE.test(file) && !repositoryFiles.has(file)) {
        violations.push({
          file: EXEMPTIONS_FILE,
          message: 'Remove the pending lint rule entry of a missing file.',
          detail: `${rule}: ${file}`,
        })
      }
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
        violations.push({
          file: EXEMPTIONS_FILE,
          message: 'Pending lint rule finding counts must be positive integers.',
          detail: `${rule}: ${file}`,
        })
      }
    }
  }
  return violations
}
