import path from 'node:path'
import { runMutation, runRequired } from './package-release-bootstrap-commands'
import {
  BOOTSTRAP_VERSION,
  createPlaceholderManifest,
  DEPRECATION_MESSAGE,
  hasCompatibleTags,
  isCompatibleBootstrapMetadata,
  isCompatibleBootstrapRecord,
  isCompatibleTrustConfiguration,
  isPublicAccess,
  PACKAGE_NAMES,
  parseJson,
  parseJsonObject,
} from './package-release-bootstrap-model'
import type { BootstrapDependencies } from './package-release-bootstrap-types'

const JSON_INDENT_SPACES = 2

export async function publishPlaceholder(
  packageName: string,
  dependencies: BootstrapDependencies,
  restrictPublishing: () => Promise<void>,
) {
  const tempDirectory = await dependencies.files.makeTempDirectory(
    `openwaggle-${packageName.slice('@openwaggle/'.length)}-`,
  )
  let publishFailure: unknown
  let restrictionFailure: unknown
  try {
    await dependencies.files.writeFile(
      path.join(tempDirectory, 'package.json'),
      `${JSON.stringify(createPlaceholderManifest(packageName), null, JSON_INDENT_SPACES)}\n`,
    )
    dependencies.writeLine(`[publish] ${packageName}@${BOOTSTRAP_VERSION} -> bootstrap`)
    try {
      await runMutation(dependencies, {
        args: ['publish', '--tag', 'bootstrap', '--access', 'public', '--ignore-scripts'],
        command: 'npm',
        cwd: tempDirectory,
      })
    } catch (error) {
      publishFailure = error
    }
    try {
      await restrictPublishing()
    } catch (error) {
      restrictionFailure = error
    }
  } finally {
    await dependencies.files.removeDirectory(tempDirectory)
  }
  if (publishFailure !== undefined && restrictionFailure !== undefined) {
    const publishMessage =
      publishFailure instanceof Error ? publishFailure.message : String(publishFailure)
    const restrictionMessage =
      restrictionFailure instanceof Error ? restrictionFailure.message : String(restrictionFailure)
    throw new Error(
      `${publishMessage} Initial restrictive MFA attempt also failed: ${restrictionMessage}`,
    )
  }
  if (restrictionFailure !== undefined) throw restrictionFailure
  if (publishFailure !== undefined) throw publishFailure
}

export async function verifyWriteAccess(
  projectRoot: string,
  username: string,
  dependencies: BootstrapDependencies,
  packageNames: readonly string[] = PACKAGE_NAMES,
) {
  const access = parseJsonObject(
    await runRequired(dependencies, {
      args: ['access', 'list', 'packages', username, '--json'],
      command: 'npm',
      cwd: projectRoot,
    }),
    'npm access list packages',
  )
  for (const packageName of packageNames) {
    if (access[packageName] !== 'read-write') {
      throw new Error(`${username} does not have read-write access to ${packageName}.`)
    }
  }
}

export async function verifyPublishedPlaceholder(
  projectRoot: string,
  packageName: string,
  dependencies: BootstrapDependencies,
) {
  const metadata = parseJson(
    await runRequired(dependencies, {
      args: ['view', `${packageName}@${BOOTSTRAP_VERSION}`, '--json'],
      command: 'npm',
      cwd: projectRoot,
    }),
    `npm view ${packageName}@${BOOTSTRAP_VERSION}`,
  )
  if (!isCompatibleBootstrapRecord(metadata, packageName)) {
    throw new Error(`${packageName} bootstrap metadata is incompatible.`)
  }
  const tags = parseJson(
    await runRequired(dependencies, {
      args: ['view', packageName, 'dist-tags', '--json'],
      command: 'npm',
      cwd: projectRoot,
    }),
    `npm view ${packageName} dist-tags`,
  )
  if (!hasCompatibleTags(tags)) {
    throw new Error(
      `${packageName} bootstrap version has unsupported dist-tags.`,
    )
  }
  const access = await runRequired(dependencies, {
    args: ['access', 'get', 'status', packageName, '--json'],
    command: 'npm',
    cwd: projectRoot,
  })
  if (!isPublicAccess(access, packageName)) {
    throw new Error(`${packageName} must be publicly visible.`)
  }
}

async function createTrust(
  projectRoot: string,
  packageName: string,
  dependencies: BootstrapDependencies,
) {
  dependencies.writeLine(`[trust] ${packageName} -> OpenWaggle/OpenWaggle/package-release.yml`)
  await runMutation(dependencies, {
    args: [
      'trust',
      'github',
      packageName,
      '--file',
      'package-release.yml',
      '--repository',
      'OpenWaggle/OpenWaggle',
      '--environment',
      'npm',
      '--allow-publish',
      '--yes',
    ],
    command: 'npm',
    cwd: projectRoot,
  })
}

async function verifyTrust(
  projectRoot: string,
  packageName: string,
  dependencies: BootstrapDependencies,
) {
  const trust = parseJson(
    await runRequired(dependencies, {
      args: ['trust', 'list', packageName, '--json'],
      command: 'npm',
      cwd: projectRoot,
    }),
    `npm trust list ${packageName}`,
  )
  if (!isCompatibleTrustConfiguration(trust)) {
    throw new Error(`${packageName} trusted publisher verification failed.`)
  }
}

async function verifyPackage(
  projectRoot: string,
  packageName: string,
  dependencies: BootstrapDependencies,
) {
  const metadata = parseJson(
    await runRequired(dependencies, {
      args: ['view', `${packageName}@${BOOTSTRAP_VERSION}`, '--json'],
      command: 'npm',
      cwd: projectRoot,
    }),
    `npm view ${packageName}@${BOOTSTRAP_VERSION}`,
  )
  if (!isCompatibleBootstrapMetadata(metadata, packageName)) {
    throw new Error(`${packageName} bootstrap metadata is incompatible.`)
  }
  await verifyPublishedPlaceholder(projectRoot, packageName, dependencies)
}

export async function restrictPackagePublishing(
  projectRoot: string,
  packageName: string,
  dependencies: BootstrapDependencies,
) {
  dependencies.writeLine(`[mfa] ${packageName} -> publish`)
  await runMutation(dependencies, {
    args: ['access', 'set', 'mfa=publish', packageName],
    command: 'npm',
    cwd: projectRoot,
  })
}

export async function configureAndVerifyPackage(
  projectRoot: string,
  packageName: string,
  dependencies: BootstrapDependencies,
  options: {
    readonly createTrust: boolean
    readonly deprecate: boolean
    readonly publishingRestricted: boolean
  },
) {
  if (!options.publishingRestricted) {
    await restrictPackagePublishing(projectRoot, packageName, dependencies)
  }
  if (options.deprecate) {
    dependencies.writeLine(`[deprecate] ${packageName}@${BOOTSTRAP_VERSION}`)
    await runMutation(dependencies, {
      args: ['deprecate', `${packageName}@${BOOTSTRAP_VERSION}`, DEPRECATION_MESSAGE],
      command: 'npm',
      cwd: projectRoot,
    })
  }
  if (options.createTrust) await createTrust(projectRoot, packageName, dependencies)
  await verifyTrust(projectRoot, packageName, dependencies)
  await verifyPackage(projectRoot, packageName, dependencies)
}
