import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  assertPackedWorkspaceDependencyRanges,
  isObject,
  parsePnpmPackTarballPath,
} from './package-smoke-assertions'
import {
  assertBrowserBundleContent,
  findPackageDependencyVersion,
  isPackageSmokeDevDependency,
  supportsPackageSmokeNodeVersion,
} from './package-smoke-runtime-assertions'
import { runPackageBrowserSmoke } from './package-browser-smoke'
import {
  readPackageSmokeEnvironment,
  type PackageManagerName,
} from './package-smoke-env'
import {
  assertRequiredPackageManagers,
  availablePackageManagers,
} from './package-smoke-package-managers'
import {
  mergePackedPackageSources,
  parsePackageSmokeArgs,
  type PackedPackageReference,
  readCanonicalPackageTarballs,
} from './package-smoke-canonical'
import {
  type PackedPackage,
  type PackageSpec,
  validatePackedPackage,
} from './package-smoke-tarballs'

const execFile = promisify(execFileCallback)
const JSON_INDENT_SPACES = 2
const EXEC_MAX_BUFFER_BYTES = 10_000_000
const FIXTURE_DIR = 'tests/fixtures/package-smoke'
const SMOKE_PROJECT_DIR = 'package-smoke-project'
const CLI_ARGUMENT_START_INDEX = 2

interface SmokeDependencyVersion { readonly name: string; readonly version: string }

const PUBLISHABLE_PACKAGES: readonly PackageSpec[] = [
  { name: '@openwaggle/extension-sdk', directory: 'packages/extension-sdk' },
  { name: '@openwaggle/extension-react', directory: 'packages/extension-react' },
  { name: '@openwaggle/waggle-core', directory: 'packages/waggle-core' },
  { name: '@openwaggle/pi-waggle', directory: 'packages/pi-waggle' },
]

const SMOKE_REGISTRY_DEPENDENCIES = [
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-tui',
  '@types/node',
  '@types/react',
  '@types/react-dom',
  'react',
  'react-dom',
  'tsx',
  'typescript',
  'vite',
]
const PACKAGE_MANAGER_INSTALL_ARGS = {
  npm: ['--ignore-scripts'],
  pnpm: ['--ignore-scripts'],
  yarn: ['--mode=skip-build', '--no-immutable'],
  bun: ['--ignore-scripts'],
} as const satisfies Record<PackageManagerName, readonly string[]>

async function runCommand(command: string, args: readonly string[], cwd: string) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  const result = await execFile(command, args, { cwd, maxBuffer: EXEC_MAX_BUFFER_BYTES })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

async function readJsonFile(filePath: string) {
  const content = await fs.readFile(filePath, 'utf8')
  const parsed: unknown = JSON.parse(content)
  return parsed
}

async function packPackage(projectRoot: string, spec: PackageSpec, packDir: string) {
  const result = await execFile(
    'pnpm',
    ['pack', '--pack-destination', packDir, '--json'],
    { cwd: path.join(projectRoot, spec.directory), maxBuffer: EXEC_MAX_BUFFER_BYTES },
  )
  return validatePackedPackage(spec, parsePnpmPackTarballPath(result.stdout))
}

async function canonicalPackedPackages(tarballDirectory: string) {
  const packageNames = new Set(PUBLISHABLE_PACKAGES.map((spec) => spec.name))
  const tarballs = await readCanonicalPackageTarballs(
    tarballDirectory,
    packageNames,
  )
  return Promise.all(
    tarballs.map((tarball) => {
      const spec = PUBLISHABLE_PACKAGES.find((candidate) => candidate.name === tarball.name)
      if (spec === undefined) throw new Error(`Unknown canonical package ${tarball.name}.`)
      return validatePackedPackage(spec, tarball.tarballPath)
    }),
  )
}

function packedPackageVersions(packedPackages: readonly PackedPackage[]) {
  return packedPackages.map((packedPackage) => {
    if (
      !isObject(packedPackage.manifest) ||
      typeof packedPackage.manifest.version !== 'string'
    ) {
      throw new Error(`${packedPackage.name} packed manifest must declare a version.`)
    }

    return { name: packedPackage.name, version: packedPackage.manifest.version }
  })
}

async function smokeDependencyVersion(projectRoot: string, dependencyName: string) {
  const manifests = [
    await readJsonFile(path.join(projectRoot, 'package.json')),
    await readJsonFile(path.join(projectRoot, 'packages/pi-waggle/package.json')),
  ]

  for (const manifest of manifests) {
    const version = findPackageDependencyVersion(manifest, dependencyName)
    if (version) return version
  }

  throw new Error(`Cannot find smoke dependency version for ${dependencyName}.`)
}

export function createSmokePackageJson(
  packedPackages: readonly PackedPackageReference[],
  smokeDependencyVersions: readonly SmokeDependencyVersion[],
) {
  const dependencies: { [name: string]: string } = {}
  const devDependencies: { [name: string]: string } = {}
  const packedDependencyOverrides: { [name: string]: string } = {}
  for (const packedPackage of packedPackages) {
    const tarballReference = `file:${packedPackage.tarballPath}`
    dependencies[packedPackage.name] = tarballReference
    packedDependencyOverrides[packedPackage.name] = tarballReference
  }
  for (const dependencyName of SMOKE_REGISTRY_DEPENDENCIES) {
    const dependency = smokeDependencyVersions.find(
      (candidate) => candidate.name === dependencyName,
    )
    if (!dependency) throw new Error(`Cannot find smoke dependency version for ${dependencyName}.`)
    if (isPackageSmokeDevDependency(dependencyName)) {
      devDependencies[dependencyName] = dependency.version
    } else {
      dependencies[dependencyName] = dependency.version
    }
  }
  return {
    private: true,
    type: 'module',
    scripts: {
      typecheck: 'tsc -p tsconfig.json --noEmit',
      'import:cjs': 'tsx require-smoke.ts',
      'import:esm': 'tsx import-smoke.ts',
      'browser:bundle': 'vite build --config vite.config.ts',
      'pi:discovery': 'tsx pi-discovery-smoke.ts',
    },
    dependencies,
    devDependencies,
    overrides: packedDependencyOverrides,
    resolutions: packedDependencyOverrides,
  }
}

async function writeSmokePackageJson(
  projectRoot: string,
  smokeProjectRoot: string,
  packedPackages: readonly PackedPackage[],
) {
  const smokeDependencyVersions = await Promise.all(
    SMOKE_REGISTRY_DEPENDENCIES.map(async (name) => ({
      name,
      version: await smokeDependencyVersion(projectRoot, name),
    })),
  )
  const packageJson = createSmokePackageJson(packedPackages, smokeDependencyVersions)
  await fs.writeFile(
    path.join(smokeProjectRoot, 'package.json'),
    `${JSON.stringify(packageJson, null, JSON_INDENT_SPACES)}\n`,
    'utf8',
  )
}

export function packageManagerInstallArgs(packageManager: PackageManagerName) {
  return PACKAGE_MANAGER_INSTALL_ARGS[packageManager]
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
  return smokeProjectRoot
}

async function runPackedPackageSmoke(root: string, packages: readonly PackedPackage[]) {
  if (!supportsPackageSmokeNodeVersion(process.versions.node)) {
    throw new Error(
      `Package consumer smoke requires Node.js >=22.19.0, found ${process.versions.node}.`,
    )
  }

  const environment = readPackageSmokeEnvironment()
  const packageManagers = await availablePackageManagers()
  assertRequiredPackageManagers(packageManagers, environment.requiredPackageManagers)
  if (packageManagers.length === 0) {
    throw new Error('Package consumer smoke requires npm, pnpm, Yarn, or Bun.')
  }

  const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-smoke-'))

  try {
    for (const packageManager of packageManagers) {
      const managerRoot = path.join(smokeRoot, packageManager.name)
      const smokeProjectRoot = await prepareSmokeProject(root, managerRoot, packages)
      console.log(`running package consumer smoke with ${packageManager.name}`)
      await runCommand(
        packageManager.command,
        ['install', ...packageManagerInstallArgs(packageManager.name)],
        smokeProjectRoot,
      )
      await runCommand(packageManager.command, ['run', 'typecheck'], smokeProjectRoot)
      await runCommand(packageManager.command, ['run', 'import:esm'], smokeProjectRoot)
      await runCommand(packageManager.command, ['run', 'import:cjs'], smokeProjectRoot)
      await runCommand(packageManager.command, ['run', 'browser:bundle'], smokeProjectRoot)
      const bundlePath = path.join(smokeProjectRoot, 'dist/browser-smoke.js')
      assertBrowserBundleContent(await fs.readFile(bundlePath, 'utf8'))
      if (environment.browserSmokeEnabled) {
        await runPackageBrowserSmoke(smokeProjectRoot, environment.browserExecutablePath)
      }
      await runCommand(packageManager.command, ['run', 'pi:discovery'], smokeProjectRoot)
    }
  } finally {
    await fs.rm(smokeRoot, { recursive: true, force: true })
  }
}

async function main(args: readonly string[]) {
  const projectRoot = process.cwd()
  const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-pack-'))

  try {
    const { tarballDirectory } = parsePackageSmokeArgs(args)
    const canonicalPackages =
      tarballDirectory === undefined ? [] : await canonicalPackedPackages(tarballDirectory)
    if (tarballDirectory === undefined) {
      await runCommand('pnpm', ['build:packages'], projectRoot)
    }
    const packDir = path.join(smokeRoot, 'tarballs'); await fs.mkdir(packDir, { recursive: true })
    const packedPackages: PackedPackage[] = []
    const canonicalNames = new Set(canonicalPackages.map((packedPackage) => packedPackage.name))

    for (const spec of PUBLISHABLE_PACKAGES) {
      const canonicalPackage = canonicalPackages.find((candidate) => candidate.name === spec.name)
      packedPackages.push(
        canonicalPackage ?? (await packPackage(projectRoot, spec, packDir)),
      )
    }
    if (canonicalNames.size !== canonicalPackages.length) {
      throw new Error('Canonical package smoke contains duplicate package tarballs.')
    }

    const selectedPackages = mergePackedPackageSources(packedPackages, canonicalPackages)
    const versions = packedPackageVersions(selectedPackages)
    for (const packedPackage of selectedPackages) {
      assertPackedWorkspaceDependencyRanges(packedPackage.name, packedPackage.manifest, versions)
    }

    await runPackedPackageSmoke(projectRoot, selectedPackages)
  } finally {
    await fs.rm(smokeRoot, { recursive: true, force: true })
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(CLI_ARGUMENT_START_INDEX)).catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
