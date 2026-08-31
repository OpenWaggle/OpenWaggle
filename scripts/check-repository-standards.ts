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
import { collectSessionSummaryColumnViolations } from './standards/session-summary-columns'

export { collectSessionSummaryColumnViolations } from './standards/session-summary-columns'

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

/**
 * Cross-tool Agent-definition importers must identify the foreign format they read. Keep the
 * exception at the adapter, its contract test, and the format picker; it must not make the removed
 * vendor-specific runtime or instruction files valid elsewhere in the repository.
 */
const foreignAgentImportFiles = new Set([
  'src/main/agents/__tests__/agent-definition-management.unit.test.ts',
  'src/main/agents/agent-definition-importer.ts',
  'src/renderer/src/features/settings/components/sections/AgentDefinitionImportDialog.tsx',
  'src/renderer/src/features/settings/components/sections/use-agent-definition-import.ts',
  'website/src/content/docs/extending/agent-definitions.md',
])

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
  if (foreignAgentImportFiles.has(normalizePath(file))) return []
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
