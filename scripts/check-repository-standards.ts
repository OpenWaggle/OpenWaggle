import path from 'node:path'
import { readFile } from 'node:fs/promises'
import fg from 'fast-glob'

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
  'coverage/**',
  'dist/**',
  'node_modules/**',
  '**/node_modules/**',
  'out/**',
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

function collectForbiddenReferenceViolations(file: string, contents: string) {
  const violations: Violation[] = []

  for (const reference of forbiddenReferences) {
    if (!contents.includes(reference)) {
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
  ]
}

function printViolations(violations: readonly Violation[]) {
  for (const violation of violations) {
    const detail = violation.detail ? ` (${violation.detail})` : ''
    console.error(`${violation.file}: ${violation.message}${detail}`)
  }
}

async function main() {
  const files = await fg(scanGlobs, {
    dot: true,
    ignore: ignoreGlobs,
    onlyFiles: true,
  })
  const violations: Violation[] = []

  for (const file of files.map(normalizePath).sort()) {
    violations.push(...(await collectViolationsForFile(file)))
  }

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
