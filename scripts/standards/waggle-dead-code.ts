/**
 * The Waggle scope of the production-only dead-code check (`scripts/check-waggle-dead-code.ts`):
 * the two Waggle packages and the desktop code that runs Waggle through them.
 */
/** Issue kinds that name one dead file, export, member, or dependency. */
const DEAD_CODE_KINDS = [
  'unused_files',
  'unused_exports',
  'unused_types',
  'unused_class_members',
  'unused_enum_members',
  'unused_dependencies',
] as const

const WAGGLE_PACKAGE_PATH = /^packages\/(?:pi-waggle|waggle-core)\//
/** Desktop Waggle modules: `waggle-run/`, `waggle-*.ts`, `*-waggle-*.ts`, never `openwaggle-*`. */
const DESKTOP_WAGGLE_PATH = /^src\/main\/(?:.*\/)?(?:waggle-run\/|(?:[^/]*-)?waggle[-.][^/]*$)/

export interface WaggleDeadCodeFinding {
  readonly kind: string
  readonly path: string
  readonly name?: string
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isWaggleScopePath(filePath: string) {
  if (filePath.includes('/__tests__/')) return false
  return WAGGLE_PACKAGE_PATH.test(filePath) || DESKTOP_WAGGLE_PATH.test(filePath)
}

function findingName(issue: Readonly<Record<string, unknown>>) {
  for (const key of ['export_name', 'member_name', 'package_name']) {
    const value = issue[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

/** The Waggle-scoped dead-code findings of a `fallow dead-code --format json` report. */
export function waggleDeadCodeFindings(report: unknown): WaggleDeadCodeFinding[] {
  if (!isRecord(report)) throw new Error('fallow did not return a JSON report object.')
  const findings: WaggleDeadCodeFinding[] = []
  for (const kind of DEAD_CODE_KINDS) {
    const issues = report[kind]
    if (!Array.isArray(issues)) continue
    for (const issue of issues) {
      if (!isRecord(issue) || typeof issue.path !== 'string' || !isWaggleScopePath(issue.path)) {
        continue
      }
      const name = findingName(issue)
      findings.push({ kind, path: issue.path, ...(name ? { name } : {}) })
    }
  }
  return findings
}
