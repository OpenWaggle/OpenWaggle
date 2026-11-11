/**
 * Repository standards: per-file rules over every tracked or untracked-but-not-ignored file, plus
 * rules across files (duplicate exported types, the memory index, design-token exemptions).
 *
 *   bun scripts/check-repository-standards.ts [files...]
 *
 * With files (the check runner's `--changed`), the per-file rules run on those files only, and a
 * cross-file rule runs when one of them is an input of that rule.
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import micromatch from 'micromatch'
import { listRepositoryFiles, readFiles } from './check/repository-files'
import { collectForbiddenReferenceViolations as collectBaseForbiddenReferenceViolations } from './standards/forbidden-references'
import {
  collectAgentMemoryFileViolations,
  collectAgentMemoryIndexViolations,
} from './standards/agent-memory'
import { collectRepositoryAdrNumberingViolations } from './standards/adr-numbering'
import { collectAstroRawButtonViolations } from './standards/astro-raw-buttons'
import { collectDuplicateExportedTypes } from './standards/duplicate-exported-types'
import { collectExactDependencyVersionViolations } from './standards/exact-dependency-versions'
import {
  collectScriptedAppLaunchViolations,
  collectUnguardedDesktopUiViolations,
} from './standards/desktop-automation'
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
import { collectRepositorySkillsLockViolations } from './standards/skills-lock'
import { collectSqliteLibraryViolations } from './standards/sqlite-library'
import { collectSyntaxRenderingViolations } from './standards/syntax-rendering'

export { collectSessionSummaryColumnViolations } from './standards/session-summary-columns'

export interface Violation {
  readonly detail?: string
  readonly file: string
  readonly message: string
}

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
  /(^|\/)(astro|babel|eslint|playwright|postcss|prettier|tailwind|vite|vitest)\.config\.(cjs|js|mjs)$/
const tsconfigPattern = /(^|\/)tsconfig[^/]*\.json$/

function normalizePath(filePath: string) {
  return filePath.split(path.sep).join('/')
}

function collectForbiddenReferenceViolations(file: string, contents: string) {
  if (foreignAgentImportFiles.has(normalizePath(file))) return []
  return collectBaseForbiddenReferenceViolations(file, contents)
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

function collectViolationsForFile(file: string, contents: string) {
  return [
    ...collectForbiddenReferenceViolations(file, contents),
    ...collectTsconfigViolations(file, contents),
    ...collectToolingConfigViolations(file),
    ...collectPackageBoundaryViolations(file, contents),
    ...collectSessionBranchConventionViolations(file, contents),
    ...collectUnguardedDesktopUiViolations(file, contents),
    ...collectScriptedAppLaunchViolations(file, contents),
    ...collectSessionSummaryColumnViolations(file, contents),
    ...collectSyntaxRenderingViolations(file, contents),
    ...collectExactDependencyVersionViolations(file, contents),
    ...collectSqliteLibraryViolations(file, contents),
    ...collectAstroRawButtonViolations(file, contents),
    ...collectAgentMemoryFileViolations(file, contents),
  ] satisfies readonly RepositoryViolation[]
}

export { collectScriptedAppLaunchViolations, collectUnguardedDesktopUiViolations }
export { containsSessionBranchPrefix }

function printViolations(violations: readonly Violation[]) {
  for (const violation of violations) {
    const detail = violation.detail ? ` (${violation.detail})` : ''
    console.error(`${violation.file}: ${violation.message}${detail}`)
  }
}

const SCRIPT_ARGUMENTS_START = 2
const MEMORY_FILES = ['MEMORY.md', '.agents/memory/**']
const DESIGN_TOKEN_FILES = ['src/renderer/src/**', 'scripts/renderer-design-token-exemptions.json']
const SKILLS_LOCK_FILES = ['skills-lock.json', '.agents/skills/**']
const ADR_FILES = ['docs/adr/**', 'docs/architecture.md']

function isScanned(file: string) {
  return (
    micromatch.isMatch(file, [...scanGlobs, ...packageBoundarySourceGlobs], { dot: true }) &&
    !micromatch.isMatch(file, ignoreGlobs, { dot: true })
  )
}

function isDuplicateTypeInput(file: string) {
  return file.startsWith('src/') && /\.tsx?$/u.test(file) && !file.includes('__tests__')
}

const matches = (globs: readonly string[]) => (file: string) =>
  micromatch.isMatch(file, [...globs], { dot: true })

interface CrossFileContext {
  readonly repositoryFiles: readonly string[]
  readonly present: ReadonlySet<string>
  readonly contentsByFile: ReadonlyMap<string, string>
}

/**
 * Rules that read more than the file they report on. A scoped run (`--changed`) runs one only when
 * a requested file matches `trigger`, present or deleted, and then reads every file `reads` names.
 */
interface CrossFileRule {
  readonly trigger: (file: string) => boolean
  readonly reads?: (file: string) => boolean
  readonly collect: (context: CrossFileContext) => readonly Violation[]
}

const CROSS_FILE_RULES: readonly CrossFileRule[] = [
  {
    trigger: isDuplicateTypeInput,
    reads: isDuplicateTypeInput,
    collect: ({ contentsByFile }) => collectDuplicateExportedTypes(contentsByFile),
  },
  {
    trigger: matches(MEMORY_FILES),
    reads: (file) => file === 'MEMORY.md',
    // The index rule reads MEMORY.md's contents and only the names of the other files.
    collect: ({ repositoryFiles, contentsByFile }) =>
      collectAgentMemoryIndexViolations(
        new Map(repositoryFiles.map((file) => [file, contentsByFile.get(file) ?? ''])),
      ),
  },
  {
    trigger: matches(DESIGN_TOKEN_FILES),
    collect: ({ present }) =>
      collectRendererDesignTokenExemptionViolations(present, readRendererDesignTokenExemptions()),
  },
  {
    trigger: matches(SKILLS_LOCK_FILES),
    collect: () => collectRepositorySkillsLockViolations(process.cwd()),
  },
  {
    trigger: matches(ADR_FILES),
    collect: () => collectRepositoryAdrNumberingViolations(process.cwd()),
  },
]

async function main(requested: readonly string[]) {
  const repositoryFiles = (await listRepositoryFiles()).filter(isScanned)
  const present = new Set(repositoryFiles)
  const scoped = requested.length > 0
  const changed = [...new Set(requested.map(normalizePath))]
  const targets = scoped ? changed.filter((file) => present.has(file)).sort() : repositoryFiles
  const rules = scoped
    ? CROSS_FILE_RULES.filter((rule) => changed.some(rule.trigger))
    : CROSS_FILE_RULES

  const toRead = new Set(targets)
  for (const rule of rules) {
    const reads = rule.reads
    if (reads !== undefined) for (const file of repositoryFiles.filter(reads)) toRead.add(file)
  }
  const contentsByFile = await readFiles([...toRead].sort())

  const context: CrossFileContext = { repositoryFiles, present, contentsByFile }
  const violations: Violation[] = [
    ...targets.flatMap((file) => collectViolationsForFile(file, contentsByFile.get(file) ?? '')),
    ...rules.flatMap((rule) => rule.collect(context)),
  ]
  if (violations.length === 0) {
    const scope = scoped ? `${targets.length} changed` : `${repositoryFiles.length}`
    console.log(`repository standards: no problems (${scope} files)`)
    return
  }

  printViolations(violations)
  process.exitCode = 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(SCRIPT_ARGUMENTS_START)).catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
