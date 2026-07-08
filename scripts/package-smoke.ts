import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  assertNoWorkspaceProtocols,
  assertPackedPackageFiles,
  isObject,
  parsePnpmPackTarballPath,
  uniqueSorted,
} from './package-smoke-assertions'

const execFile = promisify(execFileCallback)
const JSON_INDENT_SPACES = 2
const EXEC_MAX_BUFFER_BYTES = 10_000_000
const PACKAGE_TARBALL_PREFIX = 'package/'
const FIXTURE_DIR = 'tests/fixtures/package-smoke'
const SMOKE_PROJECT_DIR = 'package-smoke-project'

interface PackageSpec {
  readonly name: string
  readonly directory: string
}

interface PackedPackage {
  readonly name: string
  readonly tarballPath: string
  readonly manifest: unknown
}

const PUBLISHABLE_PACKAGES: readonly PackageSpec[] = [
  { name: '@openwaggle/extension-sdk', directory: 'packages/extension-sdk' },
  { name: '@openwaggle/extension-react', directory: 'packages/extension-react' },
  { name: '@openwaggle/waggle-core', directory: 'packages/waggle-core' },
  { name: '@openwaggle/pi-waggle', directory: 'packages/pi-waggle' },
]

const SMOKE_REGISTRY_DEPENDENCIES = [
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-tui',
  '@types/react',
  '@types/react-dom',
  'react',
  'react-dom',
  'typescript',
]

async function runCommand(command: string, args: readonly string[], cwd: string) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  const result = await execFile(command, args, { cwd, maxBuffer: EXEC_MAX_BUFFER_BYTES })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

async function runPnpm(args: readonly string[], cwd: string) {
  await runCommand('pnpm', args, cwd)
}

async function readJsonFile(filePath: string) {
  const content = await fs.readFile(filePath, 'utf8')
  const parsed: unknown = JSON.parse(content)
  return parsed
}

async function readPackedManifest(tarballPath: string) {
  const result = await execFile(
    'tar',
    ['-xOf', tarballPath, `${PACKAGE_TARBALL_PREFIX}package.json`],
    { maxBuffer: EXEC_MAX_BUFFER_BYTES },
  )
  const parsed: unknown = JSON.parse(result.stdout)
  return parsed
}

async function listTarballPackageFiles(tarballPath: string) {
  const result = await execFile('tar', ['-tf', tarballPath], { maxBuffer: EXEC_MAX_BUFFER_BYTES })
  return result.stdout
    .split('\n')
    .filter((entry) => entry.startsWith(PACKAGE_TARBALL_PREFIX))
    .map((entry) => entry.slice(PACKAGE_TARBALL_PREFIX.length))
    .filter((entry) => entry.length > 0)
}

async function packPackage(projectRoot: string, spec: PackageSpec, packDir: string) {
  const packageRoot = path.join(projectRoot, spec.directory)
  await runPnpm(['--filter', spec.name, 'build'], projectRoot)
  const result = await execFile(
    'pnpm',
    ['pack', '--pack-destination', packDir, '--json'],
    { cwd: packageRoot, maxBuffer: EXEC_MAX_BUFFER_BYTES },
  )
  const tarballPath = parsePnpmPackTarballPath(result.stdout)
  const manifest = await readPackedManifest(tarballPath)
  const files = await listTarballPackageFiles(tarballPath)

  assertPackedPackageFiles({ packageName: spec.name, manifest, files })
  assertNoWorkspaceProtocols(spec.name, manifest)

  console.log(`validated ${spec.name} tarball: ${path.basename(tarballPath)}`)
  return { name: spec.name, tarballPath, manifest }
}

function exportedRuntimeModuleIds(packedPackages: readonly PackedPackage[]) {
  const moduleIds: string[] = []

  for (const packedPackage of packedPackages) {
    if (!isObject(packedPackage.manifest) || !isObject(packedPackage.manifest.exports)) {
      continue
    }

    for (const exportKey of Object.keys(packedPackage.manifest.exports)) {
      if (exportKey.endsWith('.css')) continue

      moduleIds.push(
        exportKey === '.' ? packedPackage.name : `${packedPackage.name}${exportKey.slice(1)}`,
      )
    }
  }

  return uniqueSorted(moduleIds)
}

async function writeExportSmokeScripts(smokeProjectRoot: string, moduleIds: readonly string[]) {
  const modulesJson = JSON.stringify(moduleIds, null, JSON_INDENT_SPACES)
  await fs.writeFile(
    path.join(smokeProjectRoot, 'import-smoke.mjs'),
    `const moduleIds = ${modulesJson}\n\nfor (const moduleId of moduleIds) {\n  await import(moduleId)\n}\n\nconsole.log(\`esm export smoke passed: \${moduleIds.length}\`)\n`,
    'utf8',
  )
  await fs.writeFile(
    path.join(smokeProjectRoot, 'require-smoke.cjs'),
    `const moduleIds = ${modulesJson}\n\nfor (const moduleId of moduleIds) {\n  require(moduleId)\n}\n\nconsole.log(\`cjs export smoke passed: \${moduleIds.length}\`)\n`,
    'utf8',
  )
}

function findDependencyVersion(manifest: unknown, dependencyName: string) {
  if (!isObject(manifest)) return undefined

  const dependencyScopes = [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies]
  for (const scope of dependencyScopes) {
    if (isObject(scope) && typeof scope[dependencyName] === 'string') {
      return scope[dependencyName]
    }
  }

  return undefined
}

async function smokeDependencyVersion(projectRoot: string, dependencyName: string) {
  const manifests = [
    await readJsonFile(path.join(projectRoot, 'package.json')),
    await readJsonFile(path.join(projectRoot, 'packages/pi-waggle/package.json')),
  ]

  for (const manifest of manifests) {
    const version = findDependencyVersion(manifest, dependencyName)
    if (version) return version
  }

  throw new Error(`Cannot find smoke dependency version for ${dependencyName}.`)
}

async function writeSmokePackageJson(
  projectRoot: string,
  smokeProjectRoot: string,
  packedPackages: readonly PackedPackage[],
) {
  const dependencies: { [name: string]: string } = {}
  const devDependencies: { [name: string]: string } = {}

  for (const packedPackage of packedPackages) {
    const tarballReference = `file:${packedPackage.tarballPath}`
    dependencies[packedPackage.name] = tarballReference
  }

  for (const dependencyName of SMOKE_REGISTRY_DEPENDENCIES) {
    const version = await smokeDependencyVersion(projectRoot, dependencyName)
    const target = dependencyName === 'typescript' || dependencyName.startsWith('@types/')
    if (target) {
      devDependencies[dependencyName] = version
    } else {
      dependencies[dependencyName] = version
    }
  }

  const packageJson = {
    private: true,
    type: 'module',
    scripts: {
      typecheck: 'tsc -p tsconfig.json --noEmit',
      'import:cjs': 'node require-smoke.cjs',
      'import:esm': 'node import-smoke.mjs',
    },
    dependencies,
    devDependencies,
  }

  await fs.writeFile(
    path.join(smokeProjectRoot, 'package.json'),
    `${JSON.stringify(packageJson, null, JSON_INDENT_SPACES)}\n`,
    'utf8',
  )
}

async function writeSmokeWorkspaceConfig(
  smokeProjectRoot: string,
  packedPackages: readonly PackedPackage[],
) {
  const overrideLines = packedPackages.map(
    (packedPackage) => `  "${packedPackage.name}": "file:${packedPackage.tarballPath}"`,
  )
  const workspaceConfig = ['packages: []', '', 'overrides:', ...overrideLines, ''].join('\n')

  await fs.writeFile(path.join(smokeProjectRoot, 'pnpm-workspace.yaml'), workspaceConfig, 'utf8')
}

async function prepareSmokeProject(
  projectRoot: string,
  smokeRoot: string,
  packedPackages: readonly PackedPackage[],
) {
  const smokeProjectRoot = path.join(smokeRoot, SMOKE_PROJECT_DIR)
  await fs.cp(path.join(projectRoot, FIXTURE_DIR), smokeProjectRoot, { recursive: true })
  await writeSmokePackageJson(projectRoot, smokeProjectRoot, packedPackages)
  await writeSmokeWorkspaceConfig(smokeProjectRoot, packedPackages)
  await writeExportSmokeScripts(smokeProjectRoot, exportedRuntimeModuleIds(packedPackages))
  return smokeProjectRoot
}

async function runPackedPackageSmoke(projectRoot: string, packedPackages: readonly PackedPackage[]) {
  const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-smoke-'))

  try {
    const smokeProjectRoot = await prepareSmokeProject(projectRoot, smokeRoot, packedPackages)
    await runPnpm(['install', '--ignore-scripts'], smokeProjectRoot)
    await runPnpm(['run', 'typecheck'], smokeProjectRoot)
    await runPnpm(['run', 'import:esm'], smokeProjectRoot)
    await runPnpm(['run', 'import:cjs'], smokeProjectRoot)
  } finally {
    await fs.rm(smokeRoot, { recursive: true, force: true })
  }
}

async function main() {
  const projectRoot = process.cwd()
  const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-pack-'))

  try {
    const packDir = path.join(smokeRoot, 'tarballs')
    await fs.mkdir(packDir, { recursive: true })
    const packedPackages: PackedPackage[] = []

    for (const spec of PUBLISHABLE_PACKAGES) {
      packedPackages.push(await packPackage(projectRoot, spec, packDir))
    }

    await runPackedPackageSmoke(projectRoot, packedPackages)
  } finally {
    await fs.rm(smokeRoot, { recursive: true, force: true })
  }
}

const entrypointPath = process.argv[1]
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
