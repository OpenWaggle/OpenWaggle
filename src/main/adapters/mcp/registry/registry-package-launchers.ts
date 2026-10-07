import type { McpRegistryPackageType } from '@shared/types/mcp-registry'
import { installVerifiedMcpb } from './registry-mcpb'
import { type OciImageResolver, resolveOciImageWithDocker } from './registry-oci-resolver'
import type { RegistryResourceFetcher } from './registry-secure-download'
import {
  arrayValue,
  declaredRegistryValues,
  piLiteralMap,
  type RegistryEntryValue,
  stringValue,
} from './registry-values'

const MAX_PACKAGE_VERSION_LENGTH = 256
const MAX_PACKAGE_IDENTIFIER_LENGTH = 2_048
const MAX_CONTROL_CHARACTER_CODE = 31
const DELETE_CHARACTER_CODE = 127
const OCI_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/

/** How a Registry package is started over stdio. */
export interface RegistryPackageLauncher {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly env?: Readonly<Record<string, RegistryEntryValue>>
}

type PackageEntry = Readonly<Record<string, unknown>>

function positionalArguments(value: unknown) {
  return arrayValue(value).flatMap((argument: unknown) => {
    if (typeof argument !== 'object' || argument === null) return []
    const resolved = stringValue(Reflect.get(argument, 'value'))
    return resolved ? [resolved] : []
  })
}

/** Ranges and tags would install whatever the package registry serves on the day it starts. */
function exactPackageVersion(value: unknown) {
  const version = stringValue(value)
  if (
    !version ||
    version.length > MAX_PACKAGE_VERSION_LENGTH ||
    /[\s*^~<>=|/\\]/.test(version) ||
    /(^|[.-])[xX]($|[.-])/.test(version) ||
    ['latest', 'next', 'stable'].includes(version.toLowerCase())
  ) {
    throw new Error('Registry package requires an exact version.')
  }
  return version
}

function hasForbiddenCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return (
      /\s/.test(character) || code <= MAX_CONTROL_CHARACTER_CODE || code === DELETE_CHARACTER_CODE
    )
  })
}

function packageIdentifier(value: unknown, type: McpRegistryPackageType) {
  const identifier = stringValue(value)
  if (
    !identifier ||
    identifier.length > MAX_PACKAGE_IDENTIFIER_LENGTH ||
    identifier.startsWith('-') ||
    hasForbiddenCharacter(identifier)
  ) {
    throw new Error(`Registry ${type} package identifier is invalid.`)
  }
  return identifier
}

function assertRuntimeHint(entry: PackageEntry, expected: string) {
  const hint = stringValue(entry.runtimeHint)
  if (hint && hint !== expected) {
    throw new Error(`Registry package requested unsupported runtime ${JSON.stringify(hint)}.`)
  }
}

/** Runner flags are limited to ones that cannot change what is installed or where it runs. */
function runtimeArguments(entry: PackageEntry, allowed: ReadonlySet<string>) {
  const args = positionalArguments(entry.runtimeArguments)
  const unsupported = args.find((argument) => !allowed.has(argument))
  if (unsupported) {
    throw new Error(
      `Registry package requested unsupported runtime argument ${JSON.stringify(unsupported)}.`,
    )
  }
  return args
}

function assertPublicPackageRegistry(entry: PackageEntry, expected: string) {
  const registryBaseUrl = stringValue(entry.registryBaseUrl)
  if (!registryBaseUrl) return
  let requested: URL
  try {
    requested = new URL(registryBaseUrl)
  } catch {
    throw new Error(`Registry package requested invalid package registry ${registryBaseUrl}.`)
  }
  if (requested.username || requested.password || requested.href !== new URL(expected).href) {
    throw new Error(`Registry package requested unsupported package registry ${registryBaseUrl}.`)
  }
}

function environment(entry: PackageEntry) {
  return declaredRegistryValues(entry.environmentVariables, 'env')
}

function withEnvironment(entry: PackageEntry, launcher: Omit<RegistryPackageLauncher, 'env'>) {
  const env = environment(entry)
  return { ...launcher, ...(env ? { env } : {}) }
}

function npmLauncher(entry: PackageEntry): RegistryPackageLauncher {
  const identifier = packageIdentifier(entry.identifier, 'npm')
  const version = exactPackageVersion(entry.version)
  assertRuntimeHint(entry, 'npx')
  assertPublicPackageRegistry(entry, 'https://registry.npmjs.org')
  const runnerArgs = runtimeArguments(entry, new Set(['-y', '--yes', '--quiet']))
  const confirmed = runnerArgs.some((argument) => argument === '-y' || argument === '--yes')
  return withEnvironment(entry, {
    command: 'npx',
    args: [
      ...(confirmed ? runnerArgs : ['--yes', ...runnerArgs]),
      `${identifier}@${version}`,
      ...positionalArguments(entry.packageArguments),
    ],
  })
}

function pypiLauncher(entry: PackageEntry): RegistryPackageLauncher {
  const identifier = packageIdentifier(entry.identifier, 'pypi')
  const version = exactPackageVersion(entry.version)
  assertRuntimeHint(entry, 'uvx')
  assertPublicPackageRegistry(entry, 'https://pypi.org')
  return withEnvironment(entry, {
    command: 'uvx',
    args: [
      ...runtimeArguments(entry, new Set(['--quiet', '--no-cache'])),
      `${identifier}==${version}`,
      ...positionalArguments(entry.packageArguments),
    ],
  })
}

function nugetLauncher(entry: PackageEntry): RegistryPackageLauncher {
  const identifier = packageIdentifier(entry.identifier, 'nuget')
  const version = exactPackageVersion(entry.version)
  assertRuntimeHint(entry, 'dnx')
  assertPublicPackageRegistry(entry, 'https://api.nuget.org/v3/index.json')
  return withEnvironment(entry, {
    command: 'dnx',
    args: [
      ...runtimeArguments(entry, new Set(['-y', '--yes'])),
      `${identifier}@${version}`,
      '--yes',
      ...positionalArguments(entry.packageArguments),
    ],
  })
}

/** Docker flags could mount host directories or the Docker socket, so none are accepted. */
async function ociLauncher(
  entry: PackageEntry,
  resolveOciImage: OciImageResolver,
): Promise<RegistryPackageLauncher> {
  const identifier = packageIdentifier(entry.identifier, 'oci')
  if (positionalArguments(entry.runtimeArguments).length > 0) {
    throw new Error('Registry OCI packages may not pass Docker options.')
  }
  const resolved = await resolveOciImage(identifier)
  if (
    !OCI_DIGEST_PATTERN.test(resolved.digest) ||
    !resolved.coordinate.endsWith(`@${resolved.digest}`)
  ) {
    throw new Error('Docker did not report an exact sha256 digest for the OCI image.')
  }
  const env = environment(entry)
  return {
    command: 'docker',
    args: [
      'run',
      '--rm',
      '-i',
      ...Object.keys(env ?? {}).flatMap((name) => ['-e', name]),
      resolved.coordinate,
      ...positionalArguments(entry.packageArguments),
    ],
    ...(env ? { env } : {}),
  }
}

async function mcpbLauncher(
  entry: PackageEntry,
  input: RegistryPackageLauncherInput,
): Promise<RegistryPackageLauncher> {
  const identifier = packageIdentifier(entry.identifier, 'mcpb')
  if (positionalArguments(entry.runtimeArguments).length > 0) {
    throw new Error(
      'Registry MCPB packages start as their manifest says; runtime arguments are not accepted.',
    )
  }
  const installed = await installVerifiedMcpb({
    identifier,
    expectedSha256: stringValue(entry.fileSha256) ?? '',
    cacheRoot: input.cacheRoot,
    homeDir: input.homeDir,
    ...(input.fetchResource ? { fetchResource: input.fetchResource } : {}),
  })
  const env = { ...piLiteralMap(installed.env), ...environment(entry) }
  return {
    command: installed.command,
    args: [...installed.args, ...positionalArguments(entry.packageArguments)],
    cwd: installed.cwd,
    ...(Object.keys(env).length > 0 ? { env } : {}),
  }
}

export interface RegistryPackageLauncherInput {
  readonly type: McpRegistryPackageType
  readonly entry: PackageEntry
  /** Where verified MCPB bundles are unpacked. */
  readonly cacheRoot: string
  readonly homeDir: string
  readonly fetchResource?: RegistryResourceFetcher
  readonly resolveOciImage?: OciImageResolver
}

export async function createRegistryPackageLauncher(
  input: RegistryPackageLauncherInput,
): Promise<RegistryPackageLauncher> {
  if (input.type === 'npm') return npmLauncher(input.entry)
  if (input.type === 'pypi') return pypiLauncher(input.entry)
  if (input.type === 'nuget') return nugetLauncher(input.entry)
  if (input.type === 'oci') {
    return ociLauncher(input.entry, input.resolveOciImage ?? resolveOciImageWithDocker)
  }
  return mcpbLauncher(input.entry, input)
}
