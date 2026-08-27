import { readFile } from 'node:fs/promises'
import path from 'node:path'
import fg from 'fast-glob'
import { collectDuplicateExportedTypes } from './standards/duplicate-exported-types'
import {
  collectScriptedElectronLaunchViolations,
  collectUnguardedDesktopUiViolations,
} from './standards/electron-automation'
import {
  collectRendererDesignTokenExemptionViolations,
  readRendererDesignTokenExemptions,
} from './standards/renderer-design-token-exemptions'
import {
  collectSessionBranchConventionViolations,
  containsSessionBranchPrefix,
} from './standards/session-branch'
import {
  collectPackageBoundaryViolations,
  packageBoundarySourceGlobs,
  type RepositoryViolation,
} from './repository-package-boundaries.js'

interface Violation {
  readonly detail?: string
  readonly file: string
  readonly message: string
}

const legacyAgentFile = [['CLA', 'UDE'].join(''), 'md'].join('.')
const legacyAgentDirectory = ['.', 'claude'].join('')
const legacyLearningsName = ['learn', 'ings'].join('')
const legacyLessonsName = ['less', 'ons'].join('')
const legacyLearningsFile = ['docs', [legacyLearningsName, 'md'].join('.')].join('/')
const legacyLessonsFile = ['docs', [legacyLessonsName, 'md'].join('.')].join('/')
const legacyLearningsAlias = [legacyLearningsName.toUpperCase(), 'md'].join('.')
const legacyLessonsAlias = [legacyLessonsName.toUpperCase(), 'md'].join('.')
const legacyVendorRuntime = ['Claude', 'Code'].join(' ')

const forbiddenReferences: string[] = [
  legacyAgentFile,
  legacyAgentDirectory,
  legacyLearningsFile,
  legacyLessonsFile,
  legacyLearningsAlias,
  legacyLessonsAlias,
  legacyVendorRuntime,
]

const scanGlobs: string[] = [
  '**/*.{adoc,astro,cjs,css,html,js,json,jsonc,jsx,md,mdx,mjs,py,sh,toml,ts,tsx,txt,yaml,yml}',
]

const ignoreGlobs: string[] = [
  '.git/**',
  '.fallow/**',
  '.typecheck/**',
  'build/**',
  '.pi/**',
  'coverage/**',
  'dist/**',
  'node_modules/**',
  '**/node_modules/**',
  'out/**',
  'packages/**/.pack/**',
  'packages/**/dist/**',
  'packages/**/dist-cjs/**',
  'release/**',
  'website/.astro/**',
  'website/dist/**',
  'website/node_modules/**',
]

const toolingConfigPattern =
  /(^|\/)(astro|babel|electron\.vite|eslint|playwright|postcss|prettier|tailwind|vite|vitest)\.config\.(cjs|js|mjs)$/
const tsconfigPattern = /(^|\/)tsconfig[^/]*\.json$/

function normalizePath(filePath: string) {
  return filePath.split(path.sep).join('/')
}

/**
 * The legacy agent directory is a dotted name, so a bare substring search also
 * matches inside unrelated dotted identifiers -- notably every Bedrock Anthropic
 * model id (`eu.anthropic.claude-...`), which we legitimately reference when
 * documenting review tooling. Require the match not to be preceded by an
 * identifier character, so a real path reference still trips the guard while a
 * dotted identifier does not.
 */
function containsForbiddenReference(contents: string, reference: string) {
  if (!reference.startsWith('.')) {
    return contents.includes(reference)
  }
  const escaped = reference.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
  return new RegExp(String.raw`(?<![0-9A-Za-z])` + escaped).test(contents)
}

function collectForbiddenReferenceViolations(file: string, contents: string) {
  const violations: Violation[] = []

  for (const reference of forbiddenReferences) {
    if (!containsForbiddenReference(contents, reference)) {
      continue
    }

    violations.push({
      detail: reference,
      file,
      message: 'Remove stale legacy-agent instruction reference.',
    })
  }

  return violations
}

function collectTsconfigViolations(file: string, contents: string) {
  if (!tsconfigPattern.test(file) || !/"baseUrl"\s*:/.test(contents)) {
    return []
  }

  return [
    {
      detail: '"baseUrl"',
      file,
      message: 'Do not use TypeScript baseUrl; keep path aliases explicit through paths.',
    },
  ]
}

function collectToolingConfigViolations(file: string) {
  if (!toolingConfigPattern.test(file)) {
    return []
  }

  return [
    {
      detail: file,
      file,
      message: 'Use TypeScript-first tooling config files for repository-owned tooling.',
    },
  ]
}

async function collectViolationsForFile(file: string) {
  const contents = await readFile(file, 'utf8')

  return [
    ...collectForbiddenReferenceViolations(file, contents),
    ...collectTsconfigViolations(file, contents),
    ...collectToolingConfigViolations(file),
    ...collectPackageBoundaryViolations(file, contents),
    ...collectSessionBranchConventionViolations(file, contents),
    ...collectUnguardedDesktopUiViolations(file, contents),
    ...collectScriptedElectronLaunchViolations(file, contents),
    ...collectSessionSummaryColumnViolations(file, contents),
  ] satisfies readonly RepositoryViolation[]
}

export { collectScriptedElectronLaunchViolations, collectUnguardedDesktopUiViolations }
export { containsSessionBranchPrefix }

function printViolations(violations: readonly Violation[]) {
  for (const violation of violations) {
    const detail = violation.detail ? ` (${violation.detail})` : ''
    console.error(`${violation.file}: ${violation.message}${detail}`)
  }
}

/**
 * A SELECT column list is invisible to the type checker: `sql<SessionSummaryRow>` asserts
 * the row shape without verifying the query selects those columns.
 *
 * Observed failure: three queries typed that way omitted `environment_mode` and
 * `worktree_path`, so every session in the list reported local mode with no worktree and
 * the per-session git indicators were simply absent. Nothing failed — it was found by
 * opening the app.
 *
 * The columns now come from one fragment (`sessionSummaryColumns`). This keeps it that way
 * by rejecting a query that spells them out inline again.
 */
const SESSION_SUMMARY_QUERY_PATTERN = /sql<SessionSummaryRow>`([^`]*)`/gsu
const SESSION_SUMMARY_COLUMN_FRAGMENT = 'sessionSummaryColumns'
/**
 * The projection of a query: what sits between its first `select` and the matching `from`.
 *
 * The rule is "use the shared fragment", not "avoid one particular column name". Two earlier versions
 * were wrong in opposite directions: firing only when the list mentioned `created_at` let through the
 * very defect it was written for, and skipping any query containing `count(` anywhere exempted an
 * inline list that merely carried a `COUNT(...)` subquery - which is the shape the detail-side row
 * actually uses, so a list missing `environment_mode` and `worktree_path` went unreported again.
 * Judging the projection alone keeps `SELECT COUNT(*) AS total` passing and that subquery failing.
 */
const SESSION_SUMMARY_PROJECTION = /\bselect\b(?<projection>[\s\S]*?)\bfrom\b/iu
/**
 * A projection that names no columns of its own: only aggregate terms.
 *
 * Checked term by term. An earlier version matched anything whose *first* term was an aggregate, so an
 * inline column list sitting behind a `COUNT(*)` was exempt - the same hole, in a different disguise,
 * as the version that skipped any query containing `count(` at all.
 */
function namesNoColumns(projection: string) {
  const terms = splitTopLevelTerms(projection)
  if (terms.length === 0) return true
  return terms.every((term) => AGGREGATE_TERM.test(term.trim()))
}

const AGGREGATE_TERM = /^\(?\s*\b(?:count|sum|min|max|avg)\s*\(/iu

/** Split a projection on commas that are not inside parentheses. */
function splitTopLevelTerms(projection: string): readonly string[] {
  const terms: string[] = []
  let depth = 0
  let current = ''
  for (const character of projection) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ',' && depth === 0) {
      terms.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (current.trim().length > 0) terms.push(current)
  return terms.filter((term) => term.trim().length > 0)
}

function selectsNamedColumns(query: string) {
  const projection = SESSION_SUMMARY_PROJECTION.exec(query)?.groups?.['projection']
  if (projection === undefined) return false
  return !namesNoColumns(projection)
}
const SESSION_SUMMARY_COLUMN_OWNERS: readonly string[] = [
  // A different SessionSummaryRow: the detail-side shape with message_count and aliases.
  'src/main/store/session-details/session-queries.ts',
]

export function collectSessionSummaryColumnViolations(file: string, contents: string) {
  if (SESSION_SUMMARY_COLUMN_OWNERS.includes(normalizePath(file))) return []
  /*
   * Tests are exempt, as they are for the session-branch rule: this rule is about the queries the
   * app ships, and a test that pins the rule has to contain the very pattern it detects.
   */
  if (normalizePath(file).includes('__tests__')) return []
  const violations: Violation[] = []
  for (const match of contents.matchAll(SESSION_SUMMARY_QUERY_PATTERN)) {
    const query = match[1] ?? ''
    if (query.includes(SESSION_SUMMARY_COLUMN_FRAGMENT)) continue
    if (!selectsNamedColumns(query)) continue
    violations.push({
      file: normalizePath(file),
      message:
        'SessionSummaryRow queries must interpolate sessionSummaryColumns(sql), not list columns inline',
      detail: 'an inline list can omit a column the row type promises, and the type checker cannot see it',
    })
  }
  return violations
}

async function main() {
  const files = await fg([...scanGlobs, ...packageBoundarySourceGlobs], {
    dot: true,
    ignore: ignoreGlobs,
    onlyFiles: true,
  })
  const violations: Violation[] = []
  const contentsByFile = new Map<string, string>()

  for (const file of files.map(normalizePath).sort()) {
    violations.push(...(await collectViolationsForFile(file)))
    contentsByFile.set(file, await readFile(file, 'utf8'))
  }

  violations.push(...collectDuplicateExportedTypes(contentsByFile))
  violations.push(
    ...collectRendererDesignTokenExemptionViolations(
      new Set(contentsByFile.keys()),
      readRendererDesignTokenExemptions(),
    ),
  )

  if (violations.length === 0) {
    return
  }

  printViolations(violations)
  process.exitCode = 1
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
