import {
  isNotFound,
  isCredentialEnvironmentKey,
  redactBootstrapDiagnostic,
  runCommand,
  runRequired,
} from './package-release-bootstrap-commands'
import { inspectGithubState } from './package-release-bootstrap-github'
import {
  BOOTSTRAP_VERSION,
  hasCompatibleTags,
  isCompatibleBootstrapMetadata,
  isCompatibleBootstrapRecord,
  isCompatibleTrustConfiguration,
  isJsonObject,
  isPublicAccess,
  needsBootstrapDeprecation,
  PACKAGE_NAMES,
  parseJson,
  parseJsonObject,
  type JsonObject,
} from './package-release-bootstrap-model'
import {
  AUTOMATIC_LATEST_REPAIR_BY_CONTINUATION,
  NEXT_CONFIGURE,
  NEXT_FINALIZE,
  NEXT_PUBLISH,
  NEXT_REASSERT_MFA,
  type BootstrapDependencies,
  type BootstrapPackageProgress,
} from './package-release-bootstrap-types'

const EXPECTED_ORIGINS = [
  'git@github.com:OpenWaggle/OpenWaggle.git',
  'https://github.com/OpenWaggle/OpenWaggle.git',
] as const
const MINIMUM_NODE_VERSION = '22.19.0'
const PINNED_NPM_VERSION = '11.18.0'
const NPM_REGISTRY = 'https://registry.npmjs.org/'
const EXPECTED_REPOSITORY = 'OpenWaggle/OpenWaggle'
const MAJOR_INDEX = 0
const MINOR_INDEX = 1
const PATCH_INDEX = 2
const SEMVER_PART_COUNT = 3

function versionParts(version: string) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!match) return undefined
  const parts = [
    Number(match[MAJOR_INDEX + 1]),
    Number(match[MINOR_INDEX + 1]),
    Number(match[PATCH_INDEX + 1]),
  ]
  if (parts.length !== SEMVER_PART_COUNT || !parts.every(Number.isSafeInteger)) return undefined
  return parts
}

function isVersionAtLeast(version: string, minimum: string) {
  const actual = versionParts(version)
  const required = versionParts(minimum)
  if (!actual || !required) return false
  for (const index of [MAJOR_INDEX, MINOR_INDEX, PATCH_INDEX]) {
    const actualPart = actual[index]
    const requiredPart = required[index]
    if (actualPart === undefined || requiredPart === undefined) return false
    if (actualPart > requiredPart) return true
    if (actualPart < requiredPart) return false
  }
  return true
}

function hasWriteProtectedTwoFactorAuthentication(profile: JsonObject) {
  const tfa = profile.tfa
  return (
    (isJsonObject(tfa) && tfa.mode === 'auth-and-writes' && tfa.pending !== true) ||
    profile['two-factor auth'] === 'auth-and-writes'
  )
}

function conflict(name: string, nextAction: string): BootstrapPackageProgress {
  return { name, nextAction, state: 'conflict' }
}

function credentialEnvironmentBlockers(
  environment: Readonly<Record<string, string | undefined>>,
) {
  return Object.keys(environment)
    .filter(isCredentialEnvironmentKey)
    .filter((variableName) => Boolean(environment[variableName]))
    .sort()
    .map(
      (variableName) =>
        `${variableName} must be unset; bootstrap accepts authenticated CLI sessions only.`,
    )
}

function runtimeBlockers(nodeVersion: string, npmVersion: string, registry: string) {
  const blockers: string[] = []
  if (!isVersionAtLeast(nodeVersion, MINIMUM_NODE_VERSION)) {
    blockers.push(`Node ${MINIMUM_NODE_VERSION} or newer is required; found ${nodeVersion}.`)
  }
  if (npmVersion !== PINNED_NPM_VERSION) {
    blockers.push(`npm ${PINNED_NPM_VERSION} is required; found ${npmVersion}.`)
  }
  if (registry !== NPM_REGISTRY) {
    blockers.push(`npm registry must be exactly ${NPM_REGISTRY}; found ${registry}.`)
  }
  return blockers
}

function repositoryBlockers(status: string, branch: string, origin: string, isUpToDate: boolean) {
  const blockers: string[] = []
  if (status.length > 0) blockers.push('The worktree must be clean.')
  if (branch !== 'main') {
    blockers.push(`The current branch must be main; found ${branch || '(detached)'}.`)
  }
  if (!EXPECTED_ORIGINS.some((expected) => expected === origin)) {
    blockers.push(`origin must be exactly ${EXPECTED_REPOSITORY}; found ${origin}.`)
  }
  if (!isUpToDate) blockers.push('Local main must exactly match origin/main.')
  return blockers
}

function npmAccountBlockers(username: string, profile: JsonObject, organization: JsonObject) {
  const blockers: string[] = []
  const profileName = typeof profile.name === 'string' ? profile.name : '(missing)'
  if (profileName !== username) {
    blockers.push(
      `npm whoami must match the authenticated profile; found ${username} and ${profileName}.`,
    )
  }
  if (!hasWriteProtectedTwoFactorAuthentication(profile)) {
    blockers.push('npm account 2FA must be enabled in auth-and-writes mode.')
  }
  const role = organization[username]
  if (typeof role !== 'string' || !['owner', 'admin', 'developer'].includes(role)) {
    blockers.push(`${username} must have publish access to the @openwaggle npm organization.`)
  }
  return blockers
}

async function inspectPublishedPlaceholder(
  projectRoot: string,
  packageName: string,
  dependencies: BootstrapDependencies,
  metadata: unknown,
): Promise<BootstrapPackageProgress> {
  const tags = parseJson(
    await runRequired(dependencies, {
      args: ['view', packageName, 'dist-tags', '--json'],
      command: 'npm',
      cwd: projectRoot,
    }),
    `npm view ${packageName} dist-tags`,
  )
  const hasAutomaticLatest = isJsonObject(tags) && tags.latest === BOOTSTRAP_VERSION
  if (hasAutomaticLatest) {
    const tagsWithoutAutomaticLatest = Object.fromEntries(
      Object.entries(tags).filter(([tag]) => tag !== 'latest'),
    )
    if (!hasCompatibleTags(tagsWithoutAutomaticLatest)) {
      return conflict(packageName, 'resolve conflicting bootstrap dist-tags')
    }
  }
  if (!hasAutomaticLatest && !hasCompatibleTags(tags)) {
    return conflict(packageName, 'resolve conflicting bootstrap dist-tags')
  }
  const access = await runRequired(dependencies, {
    args: ['access', 'get', 'status', packageName, '--json'],
    command: 'npm',
    cwd: projectRoot,
  })
  if (!isPublicAccess(access, packageName)) {
    return conflict(packageName, 'make the existing bootstrap package public')
  }
  const trustOutput = await runRequired(dependencies, {
    args: ['trust', 'list', packageName, '--json'],
    command: 'npm',
    cwd: projectRoot,
  })
  const trust =
    trustOutput.length === 0 ? [] : parseJson(trustOutput, `npm trust list ${packageName}`)
  const requiresDeprecation = needsBootstrapDeprecation(metadata)
  if (!requiresDeprecation && !isCompatibleBootstrapMetadata(metadata, packageName)) {
    return conflict(packageName, 'resolve conflicting bootstrap deprecation metadata')
  }
  if (Array.isArray(trust) && trust.length === 0) {
    return pendingPackage(packageName, NEXT_CONFIGURE, hasAutomaticLatest)
  }
  if (!isCompatibleTrustConfiguration(trust)) {
    return conflict(
      packageName,
      'resolve conflicting trusted publisher without revoking it automatically',
    )
  }
  if (requiresDeprecation) {
    return pendingPackage(packageName, NEXT_FINALIZE, hasAutomaticLatest)
  }
  return pendingPackage(packageName, NEXT_REASSERT_MFA, hasAutomaticLatest)
}

function pendingPackage(
  packageName: string,
  continuation: string,
  hasAutomaticLatest: boolean,
): BootstrapPackageProgress {
  const nextAction = hasAutomaticLatest
    ? AUTOMATIC_LATEST_REPAIR_BY_CONTINUATION.get(continuation)
    : continuation
  if (nextAction === undefined) {
    throw new Error(`${packageName} has an unsupported automatic latest repair action.`)
  }
  return { name: packageName, nextAction, state: 'pending' }
}

async function inspectPackage(
  projectRoot: string,
  packageName: string,
  dependencies: BootstrapDependencies,
): Promise<BootstrapPackageProgress> {
  const packageResult = await runCommand(dependencies, {
    args: ['view', packageName, '--json'],
    command: 'npm',
    cwd: projectRoot,
  })
  if (isNotFound(packageResult)) {
    return { name: packageName, nextAction: NEXT_PUBLISH, state: 'pending' }
  }
  if (packageResult.exitCode !== 0) {
    throw new Error(
      `npm view ${packageName} failed: ${redactBootstrapDiagnostic(packageResult.stderr)}`,
    )
  }
  const metadataResult = await runCommand(dependencies, {
    args: ['view', `${packageName}@${BOOTSTRAP_VERSION}`, '--json'],
    command: 'npm',
    cwd: projectRoot,
  })
  if (isNotFound(metadataResult)) {
    return conflict(packageName, `refuse occupied package name without ${BOOTSTRAP_VERSION}`)
  }
  if (metadataResult.exitCode !== 0) {
    throw new Error(
      `npm view ${packageName}@${BOOTSTRAP_VERSION} failed: ${redactBootstrapDiagnostic(metadataResult.stderr)}`,
    )
  }
  const metadata = parseJson(
    metadataResult.stdout,
    `npm view ${packageName}@${BOOTSTRAP_VERSION}`,
  )
  if (!isCompatibleBootstrapRecord(metadata, packageName)) {
    return conflict(packageName, 'resolve conflicting bootstrap package metadata')
  }
  return inspectPublishedPlaceholder(projectRoot, packageName, dependencies, metadata)
}

async function inspectPrerequisites(
  projectRoot: string,
  dependencies: BootstrapDependencies,
) {
  const command = (name: string, args: readonly string[]) =>
    runRequired(dependencies, { args, command: name, cwd: projectRoot })
  const nodeVersion = await command('node', ['--version'])
  const npmVersion = await command('npm', ['--version'])
  const registry = await command('npm', ['config', 'get', 'registry'])
  const status = await command('git', ['status', '--porcelain'])
  const branch = await command('git', ['branch', '--show-current'])
  const origin = await command('git', ['remote', 'get-url', 'origin'])
  const head = await command('git', ['rev-parse', 'HEAD'])
  const remote = await command('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/main'])
  const username = await command('npm', ['whoami'])
  const profile = parseJsonObject(await command('npm', ['profile', 'get', '--json']), 'npm profile get')
  const organization = parseJsonObject(
    await command('npm', ['org', 'ls', 'openwaggle', username, '--json']),
    'npm org ls',
  )
  await command('gh', ['auth', 'status', '--active', '--hostname', 'github.com'])
  const isAdmin = await command('gh', [
    'api',
    '--hostname',
    'github.com',
    'repos/OpenWaggle/OpenWaggle',
    '--jq',
    '.permissions.admin',
  ])
  const githubBlockers = isAdmin === 'true'
    ? []
    : ['The active GitHub account must have admin access to OpenWaggle/OpenWaggle.']
  const remoteHead = remote.split(/\s/u)[0]
  const blockers = [
    ...credentialEnvironmentBlockers(dependencies.environment),
    ...runtimeBlockers(nodeVersion, npmVersion, registry),
    ...repositoryBlockers(status, branch, origin, head === remoteHead),
    ...npmAccountBlockers(username, profile, organization),
    ...githubBlockers,
  ]
  return blockers
}

export async function inspectBootstrapPreflight(
  projectRoot: string,
  dependencies: BootstrapDependencies,
) {
  const blockers = await inspectPrerequisites(projectRoot, dependencies)
  const packages: BootstrapPackageProgress[] = []
  for (const packageName of PACKAGE_NAMES) {
    packages.push(await inspectPackage(projectRoot, packageName, dependencies))
  }
  return {
    blockers,
    github: await inspectGithubState(projectRoot, dependencies),
    packages,
  }
}
