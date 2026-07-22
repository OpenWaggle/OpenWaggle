import { execFile } from 'node:child_process'
import { appendFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const CLI_ARGUMENT_START_INDEX = 2
const EXPECTED_CLI_ARGUMENT_COUNT = 3
const JSON_INDENT_SPACES = 2
const SEMVER_GROUP_COUNT = 3

export interface PackageReleaseDefinition {
  readonly dependency?: string
  readonly key: string
  readonly name: string
  readonly packagePath: string
}

export interface PackageReleasePlanItem extends PackageReleaseDefinition {
  readonly tag: string
  readonly version: string
}

export interface PackageReleasePlan {
  readonly packages: readonly PackageReleasePlanItem[]
  readonly schemaVersion: 1
  readonly sourceSha: string
  readonly sourceTree: string
}

export const PACKAGE_RELEASE_DEFINITIONS = [
  {
    key: 'extension-sdk',
    name: '@openwaggle/extension-sdk',
    packagePath: 'packages/extension-sdk',
  },
  {
    key: 'waggle-core',
    name: '@openwaggle/waggle-core',
    packagePath: 'packages/waggle-core',
  },
  {
    dependency: '@openwaggle/extension-sdk',
    key: 'extension-react',
    name: '@openwaggle/extension-react',
    packagePath: 'packages/extension-react',
  },
  {
    dependency: '@openwaggle/waggle-core',
    key: 'pi-waggle',
    name: '@openwaggle/pi-waggle',
    packagePath: 'packages/pi-waggle',
  },
] as const satisfies readonly PackageReleaseDefinition[]

type ReadPackageVersion = (revision: string, packagePath: string) => Promise<string>

export function assertRequiredDependentReleases(
  packages: readonly PackageReleasePlanItem[],
) {
  const releasedNames = new Set(packages.map(({ name }) => name))
  for (const definition of PACKAGE_RELEASE_DEFINITIONS) {
    if (!('dependency' in definition) || !releasedNames.has(definition.dependency)) continue
    if (!releasedNames.has(definition.name)) {
      throw new Error(
        `${definition.dependency} requires a coordinated ${definition.name} release.`,
      )
    }
  }
}

function stableSemverParts(version: string) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)
  if (match === null) {
    throw new Error(`Package release version ${version} must be a stable semantic version.`)
  }
  const parts = match.slice(1).map(Number)
  if (parts.length !== SEMVER_GROUP_COUNT || parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`Package release version ${version} is invalid.`)
  }
  return parts
}

function compareStableVersions(left: string, right: string) {
  const leftParts = stableSemverParts(left)
  const rightParts = stableSemverParts(right)
  for (let index = 0; index < SEMVER_GROUP_COUNT; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

export async function resolvePackageReleasePlan(
  source: Readonly<{ beforeSha: string; sourceSha: string; sourceTree: string }>,
  readPackageVersion: ReadPackageVersion,
): Promise<PackageReleasePlan> {
  const resolvedVersions = await Promise.all(
    PACKAGE_RELEASE_DEFINITIONS.map(async (definition) => {
      const [beforeVersion, version] = await Promise.all([
        readPackageVersion(source.beforeSha, definition.packagePath),
        readPackageVersion(source.sourceSha, definition.packagePath),
      ])
      return { beforeVersion, definition, version }
    }),
  )
  const packages: PackageReleasePlanItem[] = []
  for (const { beforeVersion, definition, version } of resolvedVersions) {
    const comparison = compareStableVersions(version, beforeVersion)
    if (comparison < 0) {
      throw new Error(`${definition.name} version must increase, not move from ${beforeVersion} to ${version}.`)
    }
    if (comparison === 0) continue
    packages.push({ ...definition, tag: `${definition.key}-v${version}`, version })
  }
  assertRequiredDependentReleases(packages)
  return {
    packages,
    schemaVersion: 1,
    sourceSha: source.sourceSha,
    sourceTree: source.sourceTree,
  }
}

function run(command: string, args: readonly string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(stderr.trim() || error.message))
        return
      }
      resolve(stdout.trim())
    })
  })
}

function isJsonObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodePlanPackage(value: unknown): PackageReleasePlanItem {
  if (!isJsonObject(value)) throw new Error('Package release plan contains a non-object package.')
  const definition = PACKAGE_RELEASE_DEFINITIONS.find(
    ({ key }) => key === value.key,
  )
  const dependency =
    definition !== undefined && 'dependency' in definition
      ? definition.dependency
      : undefined
  if (
    definition === undefined ||
    value.name !== definition.name ||
    value.packagePath !== definition.packagePath ||
    typeof value.version !== 'string' ||
    value.tag !== `${definition.key}-v${value.version}` ||
    value.dependency !== dependency
  ) {
    throw new Error('Package release plan contains an invalid package contract.')
  }
  stableSemverParts(value.version)
  return { ...definition, tag: value.tag, version: value.version }
}

export function decodePackageReleasePlan(value: unknown): PackageReleasePlan {
  if (
    !isJsonObject(value) ||
    value.schemaVersion !== 1 ||
    typeof value.sourceSha !== 'string' ||
    typeof value.sourceTree !== 'string' ||
    !Array.isArray(value.packages)
  ) {
    throw new Error('Package release plan is invalid.')
  }
  const packages = value.packages.map(decodePlanPackage)
  const keys = new Set(packages.map(({ key }) => key))
  if (keys.size !== packages.length) {
    throw new Error('Package release plan contains duplicate packages.')
  }
  assertRequiredDependentReleases(packages)
  return {
    packages,
    schemaVersion: 1,
    sourceSha: value.sourceSha,
    sourceTree: value.sourceTree,
  }
}

async function readPackageVersionAtRevision(revision: string, packagePath: string) {
  const manifestText = await run('git', ['show', `${revision}:${packagePath}/package.json`])
  const manifest: unknown = JSON.parse(manifestText)
  if (!isJsonObject(manifest) || typeof manifest.version !== 'string') {
    throw new Error(`${packagePath}/package.json at ${revision} has no string version.`)
  }
  return manifest.version
}

export async function createPackageReleasePlan(args: readonly string[]) {
  if (args.length !== EXPECTED_CLI_ARGUMENT_COUNT) {
    throw new Error('Usage: package-release-plan.ts <before-sha> <source-sha> <output-json>.')
  }
  const [beforeSha, sourceSha, outputPath] = args
  if (beforeSha === undefined || sourceSha === undefined || outputPath === undefined) {
    throw new Error('Package release plan arguments are incomplete.')
  }
  const sourceTree = await run('git', ['rev-parse', `${sourceSha}^{tree}`])
  const plan = await resolvePackageReleasePlan(
    { beforeSha, sourceSha, sourceTree },
    readPackageVersionAtRevision,
  )
  await writeFile(outputPath, `${JSON.stringify(plan, null, JSON_INDENT_SPACES)}\n`)
  const githubOutput = process.env.GITHUB_OUTPUT
  if (githubOutput !== undefined) {
    await appendFile(githubOutput, `has_release=${String(plan.packages.length > 0)}\n`)
    await appendFile(githubOutput, `source_tree=${sourceTree}\n`)
    await appendFile(githubOutput, `artifact_name=package-release-${sourceTree}\n`)
  }
  return plan
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void createPackageReleasePlan(process.argv.slice(CLI_ARGUMENT_START_INDEX)).catch(
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    },
  )
}
