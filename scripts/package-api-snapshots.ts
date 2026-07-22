import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

interface JsonObject {
  readonly [key: string]: unknown
}

interface PackageJson {
  readonly exports?: JsonObject
  readonly name: string
}

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

interface TypedExport {
  readonly declarationPath?: string
  readonly subpath: string
}

interface DeclarationBlock {
  readonly contents: string
  readonly relativePath: string
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

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toPackageJson(value: unknown, packageJsonPath: string): PackageJson {
  if (!isJsonObject(value) || typeof value.name !== 'string') {
    throw new Error(`${packageJsonPath} must contain a package name.`)
  }

  const exportsValue = isJsonObject(value.exports) ? value.exports : undefined

  return { exports: exportsValue, name: value.name }
}

async function readPackageJson(packageRoot: string) {
  const packageJsonPath = path.join(packageRoot, 'package.json')
  const parsed: unknown = JSON.parse(await readFile(packageJsonPath, 'utf8'))

  return toPackageJson(parsed, packageJsonPath)
}

function normalizeRelativePath(filePath: string) {
  return filePath.split(path.sep).join('/')
}

function normalizeExportTargetPath(targetPath: string) {
  return targetPath.replace(/^\.\//, '')
}

function declarationPathForExportTarget(target: unknown) {
  if (typeof target === 'string') {
    return undefined
  }

  if (!isJsonObject(target) || typeof target.types !== 'string') {
    return undefined
  }

  return normalizeExportTargetPath(target.types)
}

function listTypedExports(packageJson: PackageJson) {
  const exportsValue = packageJson.exports
  if (!exportsValue) {
    return [] satisfies readonly TypedExport[]
  }

  return Object.entries(exportsValue).map(([subpath, target]) => ({
    declarationPath: declarationPathForExportTarget(target),
    subpath,
  })) satisfies readonly TypedExport[]
}

function normalizeDeclarationContents(contents: string) {
  return contents.replace(/\r\n/g, '\n').trimEnd()
}

function moduleSpecifierText(moduleSpecifier: ts.Expression | undefined) {
  if (!moduleSpecifier) {
    return undefined
  }

  if (ts.isStringLiteral(moduleSpecifier) || ts.isNoSubstitutionTemplateLiteral(moduleSpecifier)) {
    return moduleSpecifier.text
  }

  return undefined
}

function moduleSpecifierTextFromImportType(argument: ts.TypeNode) {
  if (!ts.isLiteralTypeNode(argument)) {
    return undefined
  }

  return ts.isStringLiteral(argument.literal) ? argument.literal.text : undefined
}

function declarationPathForModuleSpecifier(moduleSpecifier: string) {
  if (!moduleSpecifier.startsWith('.')) {
    return undefined
  }

  if (moduleSpecifier.endsWith('.js')) {
    return `${moduleSpecifier.slice(0, -'.js'.length)}.d.ts`
  }

  if (moduleSpecifier.endsWith('.d.ts')) {
    return moduleSpecifier
  }

  return `${moduleSpecifier}.d.ts`
}

function relativeDeclarationDependencies(contents: string, filePath: string) {
  const sourceFile = ts.createSourceFile(filePath, contents, ts.ScriptTarget.Latest, true)
  const declarations: string[] = []

  function addModuleSpecifier(moduleSpecifier: string | undefined) {
    if (!moduleSpecifier) {
      return
    }

    const declarationPath = declarationPathForModuleSpecifier(moduleSpecifier)
    if (declarationPath) {
      declarations.push(declarationPath)
    }
  }

  function visit(node: ts.Node) {
    if (ts.isExportDeclaration(node) || ts.isImportDeclaration(node)) {
      addModuleSpecifier(moduleSpecifierText(node.moduleSpecifier))
    }

    if (ts.isImportTypeNode(node)) {
      addModuleSpecifier(moduleSpecifierTextFromImportType(node.argument))
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return declarations
}

async function collectDeclarationBlocks(packageRoot: string, declarationPath: string) {
  const blocks: DeclarationBlock[] = []
  const visited = new Set<string>()

  async function visit(currentDeclarationPath: string) {
    const absolutePath = path.join(packageRoot, currentDeclarationPath)
    if (visited.has(absolutePath)) {
      return
    }
    visited.add(absolutePath)

    const contents = normalizeDeclarationContents(await readFile(absolutePath, 'utf8'))
    blocks.push({
      contents,
      relativePath: normalizeRelativePath(path.relative(packageRoot, absolutePath)),
    })

    for (const childDeclarationPath of relativeDeclarationDependencies(contents, absolutePath)) {
      await visit(path.normalize(path.join(path.dirname(currentDeclarationPath), childDeclarationPath)))
    }
  }

  await visit(declarationPath)

  return blocks
}

function isMissingFileError(error: unknown) {
  return isJsonObject(error) && error.code === 'ENOENT'
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

    const declarationBlocks = await collectDeclarationBlocks(packageRoot, exportEntry.declarationPath)

    lines.push(`Types: \`${exportEntry.declarationPath}\``, '')

    for (const block of declarationBlocks) {
      lines.push(`### Declarations from \`${block.relativePath}\``, '', '```ts', block.contents, '```', '')
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

export async function checkPackageApiSnapshots({
  dryRun = false,
  packageRoots,
  projectRoot,
  snapshotDir,
  update = false,
}: CheckPackageApiSnapshotsOptions): Promise<CheckPackageApiSnapshotsResult> {
  const changedSnapshots: string[] = []
  const violations: string[] = []
  const writtenSnapshots: string[] = []

  for (const packageRoot of packageRoots) {
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

    violations.push(`${relativeSnapshotFile} is stale. Run pnpm api:snapshot:update.`)
  }

  return { changedSnapshots, violations, writtenSnapshots }
}

interface CliOptions {
  readonly dryRun: boolean
  readonly mode: 'check' | 'update'
}

function parseCliArgs(args: readonly string[]): CliOptions {
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

function printResult(result: CheckPackageApiSnapshotsResult, mode: CliOptions['mode'], dryRun: boolean) {
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
