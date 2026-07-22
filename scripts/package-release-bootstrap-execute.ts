import {
  redactBootstrapDiagnostic,
  runRequired,
} from './package-release-bootstrap-commands'
import {
  createAndVerifyGithubEnvironment,
  createAndVerifyRuleset,
} from './package-release-bootstrap-github'
import {
  configureAndVerifyPackage,
  publishPlaceholder,
  restrictPackagePublishing,
  verifyPublishedPlaceholder,
  verifyWriteAccess,
} from './package-release-bootstrap-registry'
import { inspectBootstrapPreflight } from './package-release-bootstrap-preflight'
import {
  NEXT_CONFIGURE,
  NEXT_FINALIZE,
  NEXT_PUBLISH,
  NEXT_REASSERT_MFA,
  type BootstrapDependencies,
  type BootstrapGithubProgress,
  type BootstrapPackageProgress,
  type MutablePackageProgress,
  type PackageReleaseBootstrapInput,
  type PackageReleaseBootstrapResult,
} from './package-release-bootstrap-types'

function failureResult(
  error: unknown,
  dependencies: BootstrapDependencies,
  packages: readonly BootstrapPackageProgress[],
  github: BootstrapGithubProgress,
): PackageReleaseBootstrapResult {
  const message = redactBootstrapDiagnostic(error instanceof Error ? error.message : String(error))
  dependencies.writeLine(`[blocked] ${message}`)
  return {
    blockers: [message],
    github,
    mode: 'execute',
    nextAction: 'Rerun pnpm package-release:bootstrap to inspect and resume partial state.',
    ok: false,
    packages,
  }
}

async function securePackages(
  projectRoot: string,
  username: string,
  packages: MutablePackageProgress[],
  dependencies: BootstrapDependencies,
) {
  for (const packageProgress of packages) {
    await dependencies.interruptions.protect(() =>
      securePackage(projectRoot, username, packageProgress, dependencies),
    )
  }
}

async function recoverPublishingRestriction(
  projectRoot: string,
  packageName: string,
  dependencies: BootstrapDependencies,
  cause: unknown,
): Promise<never> {
  try {
    await restrictPackagePublishing(projectRoot, packageName, dependencies)
  } catch (recoveryError) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause)
    const recoveryMessage =
      recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
    throw new Error(
      `${causeMessage} Restrictive MFA recovery also failed: ${recoveryMessage}`,
      { cause: recoveryError },
    )
  }
  throw cause
}

async function securePackage(
  projectRoot: string,
  username: string,
  packageProgress: MutablePackageProgress,
  dependencies: BootstrapDependencies,
) {
  let packageMayExist = packageProgress.nextAction !== NEXT_PUBLISH
  let publishingRestricted = false
  try {
    if (packageProgress.nextAction === NEXT_PUBLISH) {
      packageMayExist = true
      await publishPlaceholder(packageProgress.name, dependencies, () =>
        restrictPackagePublishing(projectRoot, packageProgress.name, dependencies),
      )
      publishingRestricted = true
      await verifyPublishedPlaceholder(projectRoot, packageProgress.name, dependencies)
      await verifyWriteAccess(projectRoot, username, dependencies, [packageProgress.name])
      packageProgress.nextAction = NEXT_CONFIGURE
    }
    const createTrust = packageProgress.nextAction === NEXT_CONFIGURE
    const deprecate = createTrust || packageProgress.nextAction === NEXT_FINALIZE
    const reassertMfa = packageProgress.nextAction === NEXT_REASSERT_MFA
    if (!createTrust && !deprecate && !reassertMfa) {
      throw new Error(`${packageProgress.name} has an unsupported bootstrap action.`)
    }
    await configureAndVerifyPackage(projectRoot, packageProgress.name, dependencies, {
      createTrust,
      deprecate,
      publishingRestricted,
    })
    packageProgress.nextAction = 'merge the Release Please PR'
    packageProgress.state = 'complete'
  } catch (error) {
    if (packageMayExist) {
      await recoverPublishingRestriction(
        projectRoot,
        packageProgress.name,
        dependencies,
        error,
      )
    }
    throw error
  }
}

export async function executeBootstrap(
  input: PackageReleaseBootstrapInput,
  dependencies: BootstrapDependencies,
  initialPackages: readonly BootstrapPackageProgress[],
  initialGithub: BootstrapGithubProgress,
): Promise<PackageReleaseBootstrapResult> {
  let packages: MutablePackageProgress[] = initialPackages.map((item) => ({ ...item }))
  let github = initialGithub
  try {
    dependencies.writeLine('[validate] pnpm check')
    await runRequired(dependencies, {
      args: ['check'],
      command: 'pnpm',
      cwd: input.projectRoot,
    })
    const preflight = await inspectBootstrapPreflight(input.projectRoot, dependencies)
    packages = preflight.packages.map((item) => ({ ...item }))
    github = preflight.github
    const hasConflict = packages.some((item) => item.state === 'conflict')
    if (
      preflight.blockers.length > 0 ||
      hasConflict ||
      github.environment === 'conflict' ||
      github.ruleset === 'conflict'
    ) {
      return {
        ...preflight,
        mode: 'execute',
        nextAction: 'Resolve every blocker and rerun the preflight.',
        ok: false,
      }
    }
    const username = await runRequired(dependencies, {
      args: ['whoami'],
      command: 'npm',
      cwd: input.projectRoot,
    })
    const existingPackageNames = packages
      .filter((packageProgress) => packageProgress.nextAction !== NEXT_PUBLISH)
      .map((packageProgress) => packageProgress.name)
    if (existingPackageNames.length > 0) {
      await verifyWriteAccess(
        input.projectRoot,
        username,
        dependencies,
        existingPackageNames,
      )
    }
    await securePackages(input.projectRoot, username, packages, dependencies)
    if (github.environment === 'pending') {
      await createAndVerifyGithubEnvironment(input.projectRoot, dependencies)
    }
    github = { environment: 'complete', ruleset: github.ruleset }
    if (github.ruleset === 'pending') {
      await createAndVerifyRuleset(input.projectRoot, dependencies)
    }
    github = { environment: 'complete', ruleset: 'complete' }
    return {
      blockers: [],
      github,
      mode: 'execute',
      nextAction: 'Merge the coordinated Release Please PR for the first 0.1.0 releases.',
      ok: true,
      packages,
    }
  } catch (error) {
    return failureResult(error, dependencies, packages, github)
  }
}
