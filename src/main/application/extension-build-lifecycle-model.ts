import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { DiscoveredExtensionPackage, ExtensionDiagnostic } from '../extensions/types'

export const EXTENSION_BUILD_SUCCESS_EXIT_CODE = 0

function isBuildBlockingDiagnostic(diagnostic: ExtensionDiagnostic) {
  return (
    diagnostic.severity === 'error' &&
    OPENWAGGLE_EXTENSION.DIAGNOSTIC.BUILD_BLOCKING_CODES.some((code) => code === diagnostic.code)
  )
}

function hasBuildBlockingDiagnostics(extensionPackage: DiscoveredExtensionPackage) {
  return extensionPackage.diagnostics.some(isBuildBlockingDiagnostic)
}

function truncateBuildLog(log: string) {
  if (log.length <= OPENWAGGLE_EXTENSION.LIMITS.BUILD_LOG_MAX_LENGTH) {
    return log
  }

  return log.slice(-OPENWAGGLE_EXTENSION.LIMITS.BUILD_LOG_MAX_LENGTH)
}

export function makeBuildLog(input: {
  readonly command: string
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}) {
  const sections = [
    `Command: ${input.command}`,
    `Exit code: ${input.exitCode === null ? 'unknown' : String(input.exitCode)}`,
  ]

  if (input.stdout.trim().length > 0) {
    sections.push(`stdout:\n${input.stdout.trim()}`)
  }
  if (input.stderr.trim().length > 0) {
    sections.push(`stderr:\n${input.stderr.trim()}`)
  }

  return truncateBuildLog(sections.join('\n\n'))
}

export function buildFailedDiagnostic(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly exitCode: number | null
}): ExtensionDiagnostic {
  return {
    severity: 'error',
    code: 'build-failed',
    message: `Build command failed with exit code ${input.exitCode === null ? 'unknown' : String(input.exitCode)}.`,
    path: input.extensionPackage.packagePath,
  }
}

export function buildArtifactsInvalidDiagnostic(
  extensionPackage: DiscoveredExtensionPackage,
): ExtensionDiagnostic {
  return {
    severity: 'error',
    code: 'build-artifacts-invalid',
    message: OPENWAGGLE_EXTENSION.LIFECYCLE.BUILD_ARTIFACT_VALIDATION_ERROR,
    path: extensionPackage.packagePath,
  }
}

export function buildOutputsAreValid(
  extensionPackage: DiscoveredExtensionPackage,
  approvedBuildPlanHash: string,
) {
  return (
    extensionPackage.buildPlan?.inputHash === approvedBuildPlanHash &&
    extensionPackage.contentHash !== null &&
    !hasBuildBlockingDiagnostics(extensionPackage)
  )
}
