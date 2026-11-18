import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  builtDeclarationFiles,
  collectDeclarationBlocks,
  effectModuleSpecifiers,
  listTypedExports,
  normalizeRelativePath,
  readPackageJson,
} from './support/package-declarations'

export interface CreatePackageApiSnapshotOptions {
  readonly packageRoot: string
  readonly projectRoot: string
}

export interface CheckPackageApiSnapshotsOptions {
  readonly dryRun?: boolean
  readonly packageRoots: readonly string[]
  readonly projectRoot: string
  readonly snapshotDir: string
  readonly update?: boolean
}

export interface CheckPackageApiSnapshotsResult {
  readonly changedSnapshots: readonly string[]
  readonly violations: readonly string[]
  readonly writtenSnapshots: readonly string[]
}

const FAILURE_EXIT_CODE = 1
const USER_ARGV_START_INDEX = 2
const DEFAULT_SNAPSHOT_DIR = 'scripts/api-snapshots'
const DEFAULT_PACKAGE_PATHS: readonly string[] = [
  'packages/extension-sdk',
  'packages/extension-react',
  'packages/waggle-core',
  'packages/pi-waggle',
]

function isMissingFileError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

export async function createPackageApiSnapshot({
  packageRoot,
  projectRoot,
}: CreatePackageApiSnapshotOptions) {
  const packageJson = await readPackageJson(packageRoot)
  const packagePath = normalizeRelativePath(path.relative(projectRoot, packageRoot))
  const lines: string[] = [`# ${packageJson.name}`, '', `Package path: \`${packagePath}\``, '']

  for (const exportEntry of listTypedExports(packageJson)) {
    lines.push(`## Export \`${exportEntry.subpath}\``, '')

    if (!exportEntry.declarationPath) {
      lines.push('Types: none', '')
      continue
    }

    const declarationBlocks = await collectDeclarationBlocks(
      packageRoot,
      exportEntry.declarationPath,
    )

    lines.push(`Types: \`${exportEntry.declarationPath}\``, '')

    for (const block of declarationBlocks) {
      lines.push(
        `### Declarations from \`${block.relativePath}\``,
        '',
        '```ts',
        block.contents,
        '```',
        '',
      )
    }
  }

  return lines.join('\n')
}

function snapshotFileForPackageRoot(snapshotDir: string, packageRoot: string) {
  return path.join(snapshotDir, `${path.basename(packageRoot)}.api.md`)
}

async function readSnapshotIfExists(snapshotFile: string) {
  try {
    return await readFile(snapshotFile, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined
    }
    throw error
  }
}

/**
 * Every published declaration that names an Effect module. A package's public types are its own
 * declarations, so an Effect upgrade cannot change them (ADR 0066). The check reads every `.d.ts`
 * under `dist`, not only the ones the exports reach, because npm ships them all.
 */
export async function effectDeclarationViolations(projectRoot: string, packageRoot: string) {
  const violations: string[] = []
  for (const file of await builtDeclarationFiles(packageRoot)) {
    const contents = await readFile(path.join(packageRoot, file), 'utf8')
    for (const specifier of effectModuleSpecifiers(contents)) {
      const published = normalizeRelativePath(
        path.relative(projectRoot, path.join(packageRoot, file)),
      )
      violations.push(
        `${published} imports ${specifier}. Published declarations must not name Effect types.`,
      )
    }
  }
  return violations
}

export async function checkPackageApiSnapshots({
  dryRun = false,
  packageRoots,
  projectRoot,
  snapshotDir,
  update = false,
}: CheckPackageApiSnapshotsOptions) {
  const changedSnapshots: string[] = []
  const violations: string[] = []
  const writtenSnapshots: string[] = []

  for (const packageRoot of packageRoots) {
    violations.push(...(await effectDeclarationViolations(projectRoot, packageRoot)))
    const snapshotFile = snapshotFileForPackageRoot(snapshotDir, packageRoot)
    const expectedSnapshot = await createPackageApiSnapshot({ packageRoot, projectRoot })
    const actualSnapshot = await readSnapshotIfExists(snapshotFile)

    if (actualSnapshot === expectedSnapshot) {
      continue
    }

    const relativeSnapshotFile = normalizeRelativePath(path.relative(projectRoot, snapshotFile))
    changedSnapshots.push(relativeSnapshotFile)

    if (update) {
      if (!dryRun) {
        await mkdir(path.dirname(snapshotFile), { recursive: true })
        await writeFile(snapshotFile, expectedSnapshot)
        writtenSnapshots.push(relativeSnapshotFile)
      }
      continue
    }

    violations.push(`${relativeSnapshotFile} is stale. Run bun run api:snapshot:update.`)
  }

  return { changedSnapshots, violations, writtenSnapshots }
}

interface CliOptions {
  readonly dryRun: boolean
  readonly mode: 'check' | 'update'
}

function parseCliArgs(args: readonly string[]) {
  let mode: CliOptions['mode'] = 'check'
  let dryRun = false

  for (const arg of args) {
    if (arg === '--check') {
      mode = 'check'
      continue
    }
    if (arg === '--update') {
      mode = 'update'
      continue
    }
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }

    throw new Error(`Unknown package API snapshot argument: ${arg}`)
  }

  return { dryRun, mode }
}

function defaultPackageRoots(projectRoot: string) {
  return DEFAULT_PACKAGE_PATHS.map((packagePath) => path.join(projectRoot, packagePath))
}

function printResult(
  result: CheckPackageApiSnapshotsResult,
  mode: CliOptions['mode'],
  dryRun: boolean,
) {
  for (const violation of result.violations) {
    console.error(violation)
  }

  if (result.changedSnapshots.length === 0) {
    console.log('Package API snapshots are current.')
    return
  }

  if (mode === 'update' && dryRun) {
    for (const snapshotFile of result.changedSnapshots) {
      console.log(`Would update ${snapshotFile}.`)
    }
    return
  }

  if (mode === 'update') {
    for (const snapshotFile of result.writtenSnapshots) {
      console.log(`Updated ${snapshotFile}.`)
    }
  }
}

async function runCli(args: readonly string[]) {
  const options = parseCliArgs(args)
  const projectRoot = process.cwd()
  const result = await checkPackageApiSnapshots({
    dryRun: options.dryRun,
    packageRoots: defaultPackageRoots(projectRoot),
    projectRoot,
    snapshotDir: path.join(projectRoot, DEFAULT_SNAPSHOT_DIR),
    update: options.mode === 'update',
  })

  printResult(result, options.mode, options.dryRun)

  if (options.mode === 'check' && result.violations.length > 0) {
    process.exitCode = FAILURE_EXIT_CODE
  }
}

const currentModulePath = fileURLToPath(import.meta.url)

if (process.argv[1] === currentModulePath) {
  void runCli(process.argv.slice(USER_ARGV_START_INDEX)).catch((error: unknown) => {
    console.error(error)
    process.exitCode = FAILURE_EXIT_CODE
  })
}
