import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionBuildPlan,
  ExtensionDiagnostic,
  ExtensionInstallSource,
} from '../../extensions/types'
import { calculateBuildPlanHash } from './package-files'

interface ManifestBuildPlanSource {
  readonly builtArtifacts: readonly string[]
  readonly sourceFiles: readonly string[]
  readonly install?: {
    readonly source: ExtensionInstallSource
  }
  readonly build?: {
    readonly command: string
    readonly outputs?: readonly string[]
  }
}

function normalizeManifestPath(relativePath: string) {
  return relativePath.replaceAll(
    OPENWAGGLE_EXTENSION.PATH.WINDOWS_SEPARATOR,
    OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR,
  )
}

function getManifestInstallSource(manifest: ManifestBuildPlanSource): ExtensionInstallSource {
  return manifest.install?.source ?? OPENWAGGLE_EXTENSION.INSTALL_SOURCE.PREBUILT
}

function getManifestBuildOutputPaths(manifest: ManifestBuildPlanSource) {
  return manifest.build?.outputs ?? manifest.builtArtifacts
}

function buildPlanDiagnostics(manifest: ManifestBuildPlanSource): readonly ExtensionDiagnostic[] {
  const diagnostics: ExtensionDiagnostic[] = []
  const installSource = getManifestInstallSource(manifest)
  const buildCommand = manifest.build?.command

  if (
    installSource === OPENWAGGLE_EXTENSION.INSTALL_SOURCE.LOCAL_BUILD &&
    buildCommand === undefined
  ) {
    diagnostics.push({
      severity: 'error',
      code: 'build-command-missing',
      message: 'Local-build extension packages must declare build.command.',
    })
  }

  const builtArtifacts = new Set(manifest.builtArtifacts.map(normalizeManifestPath))
  for (const outputPath of getManifestBuildOutputPaths(manifest)) {
    if (!builtArtifacts.has(normalizeManifestPath(outputPath))) {
      diagnostics.push({
        severity: 'error',
        code: 'build-output-not-artifact',
        message: 'Declared build output must also be listed in builtArtifacts.',
        path: outputPath,
      })
    }
  }

  return diagnostics
}

export async function getExtensionBuildPlan(
  packagePath: string,
  rawManifest: string,
  manifest: ManifestBuildPlanSource,
): Promise<{
  readonly buildPlan: ExtensionBuildPlan | null
  readonly diagnostics: readonly ExtensionDiagnostic[]
}> {
  const installSource = getManifestInstallSource(manifest)
  const buildCommand = manifest.build?.command ?? null
  const diagnostics = buildPlanDiagnostics(manifest)

  if (installSource === OPENWAGGLE_EXTENSION.INSTALL_SOURCE.PREBUILT && buildCommand === null) {
    return { buildPlan: null, diagnostics }
  }

  const buildPlanHash =
    buildCommand === null
      ? { contentHash: null, diagnostics: [] }
      : await calculateBuildPlanHash(packagePath, rawManifest, {
          sourceFiles: manifest.sourceFiles,
          buildCommand,
        })

  return {
    buildPlan: {
      installSource,
      command: buildCommand,
      outputPaths: getManifestBuildOutputPaths(manifest),
      approvalRequired: installSource === OPENWAGGLE_EXTENSION.INSTALL_SOURCE.LOCAL_BUILD,
      inputHash: buildPlanHash.contentHash,
    },
    diagnostics: [...diagnostics, ...buildPlanHash.diagnostics],
  }
}
