import { isRecord } from './records'

/**
 * The Waggle scope of the production-only dead-code check (`scripts/check-waggle-dead-code.ts`):
 * the two Waggle packages, every app file that imports one of them, the desktop agent policy
 * modules under `src/main/agent/`, files in a `waggle/` or `waggle-run/` directory, and files whose
 * name contains Waggle outside `openwaggle`. Tests are never in scope. An unused export or member
 * named for Waggle counts in any app file, such as a re-export in a module whose name does not say
 * Waggle.
 */
const WAGGLE_PACKAGE_PATH = /^packages\/(?:pi-waggle|waggle-core)\//
const DESKTOP_AGENT_POLICY_PATH = /^src\/main\/agent\//
const WAGGLE_DIRECTORY = /(?:^|\/)waggle(?:-run)?\//
const WAGGLE_PACKAGE_IMPORT = /(?:from\s+|import\s*\(\s*)['"]@openwaggle\/(?:pi-waggle|waggle-core)(?:\/[^'"]*)?['"]/
/** Waggle in a file or symbol name, but not as part of OpenWaggle. */
const WAGGLE_SYMBOL_NAME = /(?<![Oo]pen)[Ww]aggle/
const TEST_PATH = /(?:^|\/)__tests__\/|\.test\.[cm]?tsx?$|(?:^|\/)test-(?:utils|support)(?:\/|\.)/

/**
 * The fallow report keys this check reads, and the report version they are read from. A fallow
 * upgrade that changes either fails the check instead of silently finding nothing.
 */
const FALLOW_REPORT_SCHEMA_VERSION = 10
const DEAD_CODE_KINDS = [
  'unused_files',
  'unused_exports',
  'unused_types',
  'unused_class_members',
  'unused_enum_members',
  'unused_dependencies',
  'type_only_dependencies',
  'test_only_dependencies',
] as const

export interface WaggleDeadCodeFinding {
  readonly kind: string
  readonly path: string
  readonly name?: string
}

/** Whether a repository file, given its contents, belongs to the Waggle dead-code scope. */
export function isWaggleScopeFile(filePath: string, contents: string) {
  if (TEST_PATH.test(filePath)) return false
  if (WAGGLE_PACKAGE_PATH.test(filePath)) return true
  if (!filePath.startsWith('src/')) return false
  return (
    DESKTOP_AGENT_POLICY_PATH.test(filePath) ||
    WAGGLE_DIRECTORY.test(filePath) ||
    WAGGLE_SYMBOL_NAME.test(filePath.slice(filePath.lastIndexOf('/') + 1)) ||
    WAGGLE_PACKAGE_IMPORT.test(contents)
  )
}

function findingName(issue: Readonly<Record<string, unknown>>) {
  for (const key of ['export_name', 'member_name', 'package_name']) {
    const value = issue[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

/** The findings of a `fallow dead-code --format json` report in files of `scope`. */
export function waggleDeadCodeFindings(report: unknown, scope: ReadonlySet<string>) {
  if (!isRecord(report)) throw new Error('fallow did not return a JSON report object.')
  if (report.schema_version !== FALLOW_REPORT_SCHEMA_VERSION) {
    throw new Error(
      `fallow report schema ${String(report.schema_version)} is not ${String(FALLOW_REPORT_SCHEMA_VERSION)}; check the keys this check reads before updating it.`,
    )
  }
  const findings: WaggleDeadCodeFinding[] = []
  for (const kind of DEAD_CODE_KINDS) {
    const issues = report[kind]
    if (!Array.isArray(issues)) throw new Error(`fallow report has no ${kind} list.`)
    for (const issue of issues) {
      if (!isRecord(issue) || typeof issue.path !== 'string') continue
      const name = findingName(issue)
      const waggleSymbol =
        name !== undefined &&
        WAGGLE_SYMBOL_NAME.test(name) &&
        issue.path.startsWith('src/') &&
        !TEST_PATH.test(issue.path)
      if (!scope.has(issue.path) && !waggleSymbol) continue
      findings.push({ kind, path: issue.path, ...(name ? { name } : {}) })
    }
  }
  return findings
}
