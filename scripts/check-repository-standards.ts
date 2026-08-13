import { readFile } from 'node:fs/promises'
import path from 'node:path'
import fg from 'fast-glob'
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
  '.tsbuild/**',
  '.tsbuild-renderer-tests/**',
  'build/**',
  '.pi/**',
  'coverage/**',
  'dist/**',
  'node_modules/**',
  '**/node_modules/**',
  'out/**',
  '.tsbuild/**',
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

/**
 * The Session worktree branch convention must exist in exactly one place.
 *
 * Observed failure: worktree birth derived the branch from the session id while
 * worktree recreation derived it from the recorded path's last segment. Recreation is
 * supposed to reattach the surviving branch so commits made in the old tree are kept;
 * because the two names disagreed it created a divergent branch at the base ref and
 * stranded the session's commit on the orphaned original. A single source of truth is
 * only durable if re-deriving the name elsewhere is caught.
 */
const SESSION_BRANCH_PREFIX_LITERAL = ['ow', 'session-'].join('/')
const SESSION_BRANCH_CONVENTION_OWNER = 'src/shared/utils/worktree.ts'

function collectSessionBranchConventionViolations(file: string, contents: string) {
  const normalized = normalizePath(file)
  if (normalized === SESSION_BRANCH_CONVENTION_OWNER) return []
  if (normalized.includes('__tests__') || normalized.includes('/docs/')) return []
  if (!contents.includes(`\`${SESSION_BRANCH_PREFIX_LITERAL}$`)) return []
  return [
    {
      file: normalized,
      message: `Session worktree branch names must come from sessionWorktreeBranch() in ${SESSION_BRANCH_CONVENTION_OWNER}`,
      detail: `found a local "${SESSION_BRANCH_PREFIX_LITERAL}" template literal`,
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
  ] satisfies readonly RepositoryViolation[]
}

function printViolations(violations: readonly Violation[]) {
  for (const violation of violations) {
    const detail = violation.detail ? ` (${violation.detail})` : ''
    console.error(`${violation.file}: ${violation.message}${detail}`)
  }
}

/**
 * Two exported types with the same name in sibling modules is a trap this repository has
 * already fallen into.
 *
 * Observed failure: `SessionSummaryRow` exists in both `store/sessions/types.ts` and
 * `store/session-details/types.ts` with different shapes, and each has its own
 * `hydrateSessionSummary`. A change meant for the session list was made to the
 * detail-side function instead. It typechecked, its own test passed, and the feature was
 * simply absent until the app was opened.
 *
 * The existing collisions are listed rather than fixed here: several are legitimate
 * (independent extension enums), and the row-type pairs are a refactor of their own. The
 * value is that the list is checked in — so the traps are visible — and that adding a
 * new collision fails.
 */
const KNOWN_DUPLICATE_EXPORTED_TYPES: readonly string[] = [
  'ExtensionBuildRunStatus',
  'ExtensionDiagnosticCode',
  'ExtensionDiagnosticSeverity',
  'ExtensionInstallSource',
  'ExtensionReloadStatus',
  'ExtensionStorageKind',
  'ExtensionStorageScope',
  'MutableValueRef',
  'SessionActiveRunRow',
  'SessionBranchRow',
  'SessionBranchStateRow',
  'SessionSummaryRow',
  'UpdateSessionRuntimeInput',
  'WaggleInfo',
  'WorktreeSendPlan',
]

const EXPORTED_TYPE_DECLARATION = /^export (?:interface|type) ([A-Za-z0-9_]+)/gmu

function collectDuplicateExportedTypes(
  filesWithContents: ReadonlyMap<string, string>,
): readonly Violation[] {
  const declarationsByName = new Map<string, string[]>()
  for (const [file, contents] of filesWithContents) {
    /*
     * Scoped to src/. packages/extension-sdk deliberately mirrors shared types as its
     * public surface, so those pairs are by design rather than a trap.
     */
    if (!file.startsWith('src/')) continue
    if (file.includes('__tests__') || !/\.tsx?$/u.test(file)) continue
    for (const match of contents.matchAll(EXPORTED_TYPE_DECLARATION)) {
      const name = match[1]
      if (name === undefined) continue
      const files = declarationsByName.get(name) ?? []
      files.push(file)
      declarationsByName.set(name, files)
    }
  }

  const violations: Violation[] = []
  for (const [name, declaringFiles] of [...declarationsByName].sort()) {
    const unique = [...new Set(declaringFiles)].sort()
    if (unique.length < 2) continue
    if (KNOWN_DUPLICATE_EXPORTED_TYPES.includes(name)) continue
    violations.push({
      file: unique[0] ?? name,
      message: `Exported type "${name}" is declared in ${unique.length} modules; give each a name that says which it is`,
      detail: unique.join(', '),
    })
  }

  // A resolved collision must be removed from the list, so it can only shrink.
  const declaredNames = new Set(declarationsByName.keys())
  for (const name of KNOWN_DUPLICATE_EXPORTED_TYPES) {
    const unique = new Set(declarationsByName.get(name) ?? [])
    if (!declaredNames.has(name) || unique.size < 2) {
      violations.push({
        file: 'scripts/check-repository-standards.ts',
        message: `"${name}" is no longer a duplicate exported type; remove it from KNOWN_DUPLICATE_EXPORTED_TYPES`,
      })
    }
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
