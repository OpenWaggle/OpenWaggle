import type { McpConfigCredentialValue } from '@shared/types/mcp'
import { installVerifiedMcpb } from './registry-mcpb'
import { type OciImageResolver, resolveOciImageWithDocker } from './registry-oci-resolver'
import type { RegistryResourceFetcher } from './registry-secure-download'

export type McpRegistryPackageType = 'npm' | 'pypi' | 'nuget' | 'oci' | 'mcpb'

const MAX_PACKAGE_VERSION_LENGTH = 256
const MAX_PACKAGE_IDENTIFIER_LENGTH = 2_048
const MAX_CONTROL_CHARACTER_CODE = 31
const DELETE_CHARACTER_CODE = 127

interface PackageLauncher {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly env?: Readonly<Record<string, McpConfigCredentialValue>>
  readonly coordinate: string
  readonly digest?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value.map((entry: unknown) => entry) : []
}

function secretReference(name: string): McpConfigCredentialValue {
  return { secret: name.replace(/[^A-Za-z0-9._-]+/g, '_').toUpperCase() }
}

export function declaredRegistryCredentials(value: unknown) {
  const result: Record<string, McpConfigCredentialValue> = {}
  for (const candidate of arrayValue(value)) {
    if (!isRecord(candidate)) continue
    const name = stringValue(candidate.name)
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue
    const fallback = stringValue(candidate.default) ?? stringValue(candidate.value)
    result[name] = candidate.isSecret === true || !fallback ? secretReference(name) : fallback
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function positionalArguments(value: unknown) {
  return arrayValue(value).flatMap((argument: unknown) => {
    if (!isRecord(argument)) return []
    const resolved = stringValue(argument.value)
    return resolved ? [resolved] : []
  })
}

function exactPackageVersion(value: unknown) {
  const version = stringValue(value)
  if (
    !version ||
    version.length > MAX_PACKAGE_VERSION_LENGTH ||
    /[\s*^~<>=|/\\]/.test(version) ||
    /(^|[.-])[xX]($|[.-])/.test(version) ||
    ['latest', 'next', 'stable'].includes(version.toLowerCase())
  ) {
    throw new Error('Registry package requires an exact immutable version.')
  }
  return version
}

function validatePackageIdentifier(value: unknown, type: McpRegistryPackageType) {
  const identifier = stringValue(value)
  const hasForbiddenCharacter = [...(identifier ?? '')].some((character) => {
    const code = character.charCodeAt(0)
    return (
      /\s/.test(character) || code <= MAX_CONTROL_CHARACTER_CODE || code === DELETE_CHARACTER_CODE
    )
  })
  if (
    !identifier ||
    identifier.length > MAX_PACKAGE_IDENTIFIER_LENGTH ||
    identifier.startsWith('-') ||
    hasForbiddenCharacter
  ) {
    throw new Error(`Registry ${type} package identifier is invalid.`)
  }
  return identifier
}

function assertRuntimeHint(entry: Readonly<Record<string, unknown>>, expected: string) {
  const hint = stringValue(entry.runtimeHint)
  if (hint && hint !== expected) {
    throw new Error(`Registry package requested unsupported runtime ${JSON.stringify(hint)}.`)
  }
}

function safeRuntimeArguments(
  entry: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
) {
  const args = positionalArguments(entry.runtimeArguments)
  const unsafe = args.find((argument) => !allowed.has(argument))
  if (unsafe) {
    throw new Error(`Registry package requested unsafe runtime argument ${JSON.stringify(unsafe)}.`)
  }
  return args
}

function assertOfficialRegistry(entry: Readonly<Record<string, unknown>>, expected: string) {
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

function registryEnvironment(entry: Readonly<Record<string, unknown>>) {
  return declaredRegistryCredentials(entry.environmentVariables)
}

function npmLauncher(entry: Readonly<Record<string, unknown>>): PackageLauncher {
  const identifier = validatePackageIdentifier(entry.identifier, 'npm')
  const version = exactPackageVersion(entry.version)
  assertRuntimeHint(entry, 'npx')
  assertOfficialRegistry(entry, 'https://registry.npmjs.org')
  const runtimeArguments = safeRuntimeArguments(entry, new Set(['-y', '--yes', '--quiet']))
  const confirmedRuntimeArguments = runtimeArguments.some(
    (argument) => argument === '-y' || argument === '--yes',
  )
    ? runtimeArguments
    : ['--yes', ...runtimeArguments]
  return {
    command: 'npx',
    args: [
      ...confirmedRuntimeArguments,
      `${identifier}@${version}`,
      ...positionalArguments(entry.packageArguments),
    ],
    env: registryEnvironment(entry),
    coordinate: `npm:${identifier}@${version}`,
  }
}

function pypiLauncher(entry: Readonly<Record<string, unknown>>): PackageLauncher {
  const identifier = validatePackageIdentifier(entry.identifier, 'pypi')
  const version = exactPackageVersion(entry.version)
  assertRuntimeHint(entry, 'uvx')
  assertOfficialRegistry(entry, 'https://pypi.org')
  const runtimeArguments = safeRuntimeArguments(entry, new Set(['--quiet', '--no-cache']))
  return {
    command: 'uvx',
    args: [
      ...runtimeArguments,
      `${identifier}==${version}`,
      ...positionalArguments(entry.packageArguments),
    ],
    env: registryEnvironment(entry),
    coordinate: `pypi:${identifier}==${version}`,
  }
}

function nugetLauncher(entry: Readonly<Record<string, unknown>>): PackageLauncher {
  const identifier = validatePackageIdentifier(entry.identifier, 'nuget')
  const version = exactPackageVersion(entry.version)
  assertRuntimeHint(entry, 'dnx')
  assertOfficialRegistry(entry, 'https://api.nuget.org/v3/index.json')
  const runtimeArguments = safeRuntimeArguments(entry, new Set(['-y', '--yes']))
  return {
    command: 'dnx',
    args: [
      ...runtimeArguments,
      `${identifier}@${version}`,
      '--yes',
      ...positionalArguments(entry.packageArguments),
    ],
    env: registryEnvironment(entry),
    coordinate: `nuget:${identifier}@${version}`,
  }
}

async function ociLauncher(
  entry: Readonly<Record<string, unknown>>,
  resolveOciImage: OciImageResolver,
): Promise<PackageLauncher> {
  const identifier = validatePackageIdentifier(entry.identifier, 'oci')
  if (positionalArguments(entry.runtimeArguments).length > 0) {
    throw new Error(
      'Registry OCI runtime arguments are not accepted because they can expand host authority.',
    )
  }
  const resolved = await resolveOciImage(identifier)
  if (
    !/^sha256:[a-f0-9]{64}$/.test(resolved.digest) ||
    !resolved.coordinate.endsWith(`@${resolved.digest}`)
  ) {
    throw new Error('OCI resolver did not return a verified immutable sha256 coordinate.')
  }
  const env = registryEnvironment(entry)
  const environmentArgs = Object.keys(env ?? {}).flatMap((name) => ['-e', name])
  return {
    command: 'docker',
    args: [
      'run',
      '--rm',
      '-i',
      ...environmentArgs,
      resolved.coordinate,
      ...positionalArguments(entry.packageArguments),
    ],
    ...(env ? { env } : {}),
    coordinate: `oci:${resolved.coordinate}`,
    digest: resolved.digest,
  }
}

async function mcpbLauncher(
  entry: Readonly<Record<string, unknown>>,
  input: {
    readonly cacheRoot: string
    readonly homeDir: string
    readonly fetchResource?: RegistryResourceFetcher
  },
): Promise<PackageLauncher> {
  const identifier = validatePackageIdentifier(entry.identifier, 'mcpb')
  const expectedSha256 = stringValue(entry.fileSha256)
  if (positionalArguments(entry.runtimeArguments).length > 0) {
    throw new Error(
      'MCPB runtime arguments are not accepted outside the verified manifest contract.',
    )
  }
  const installed = await installVerifiedMcpb({
    identifier,
    expectedSha256: expectedSha256 ?? '',
    cacheRoot: input.cacheRoot,
    homeDir: input.homeDir,
    ...(input.fetchResource ? { fetchResource: input.fetchResource } : {}),
  })
  const registryEnv = registryEnvironment(entry)
  const env = { ...installed.env, ...registryEnv }
  return {
    command: installed.command,
    args: [...installed.args, ...positionalArguments(entry.packageArguments)],
    cwd: installed.cwd,
    ...(Object.keys(env).length > 0 ? { env } : {}),
    coordinate: installed.coordinate,
    digest: installed.digest,
  }
}

export async function createRegistryPackageLauncher(input: {
  readonly type: McpRegistryPackageType
  readonly entry: Readonly<Record<string, unknown>>
  readonly cacheRoot: string
  readonly homeDir: string
  readonly fetchResource?: RegistryResourceFetcher
  readonly resolveOciImage?: OciImageResolver
}): Promise<PackageLauncher> {
  if (input.type === 'npm') return npmLauncher(input.entry)
  if (input.type === 'pypi') return pypiLauncher(input.entry)
  if (input.type === 'nuget') return nugetLauncher(input.entry)
  if (input.type === 'oci') {
    return ociLauncher(input.entry, input.resolveOciImage ?? resolveOciImageWithDocker)
  }
  return mcpbLauncher(input.entry, input)
}
