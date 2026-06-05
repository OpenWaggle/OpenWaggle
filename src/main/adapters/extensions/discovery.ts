import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { formatErrorMessage, isEnoent } from '@shared/utils/node-error'
import { checkExtensionSdkCompatibility } from '../../extensions/sdk-compatibility'
import type {
  DiscoveredExtensionPackage,
  ExtensionDiagnostic,
  ExtensionDiscoveryOptions,
  ExtensionDiscoveryRoot,
  ExtensionPackageScope,
  ExtensionSdkCompatibility,
} from '../../extensions/types'
import { getExtensionBuildPlan } from './build-plan'
import { getManifestContentHashInput } from './content-hash-input'
import { getProjectExtensionRoot } from './extension-paths'
import { loadExtensionManifest } from './manifest-loader'
import { calculateContentHash, validateDeclaredFiles } from './package-files'
import { diagnoseRuntimeRequirements } from './runtime-requirements'

function scopeSortKey(scope: ExtensionPackageScope) {
  return scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    ? OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    : OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND
}

function compareDiscoveredPackages(
  left: DiscoveredExtensionPackage,
  right: DiscoveredExtensionPackage,
) {
  const scopeComparison = scopeSortKey(left.scope).localeCompare(scopeSortKey(right.scope))
  return scopeComparison !== 0 ? scopeComparison : left.id.localeCompare(right.id)
}

function getDiscoveryRoots(options: ExtensionDiscoveryOptions): readonly ExtensionDiscoveryRoot[] {
  const roots: ExtensionDiscoveryRoot[] = []
  if (options.globalRootPath) {
    roots.push({
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      rootPath: options.globalRootPath,
    })
  }
  if (options.projectPath) {
    roots.push({
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: options.projectPath },
      rootPath: getProjectExtensionRoot(options.projectPath),
    })
  }
  return roots
}

async function listPackageDirectories(rootPath: string) {
  try {
    const entries = await readdir(rootPath, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if (isEnoent(error)) {
      return []
    }
    throw error
  }
}

function getManifestPath(packagePath: string) {
  return path.join(packagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE)
}

function getSdkCompatibility(
  requiredRange: string,
  hostSdkVersion: string,
): ExtensionSdkCompatibility {
  return checkExtensionSdkCompatibility(requiredRange, hostSdkVersion)
}

function sdkDiagnostics(compatibility: ExtensionSdkCompatibility): readonly ExtensionDiagnostic[] {
  if (compatibility.compatible) {
    return []
  }
  return [
    {
      severity: 'error',
      code: compatibility.reason?.includes('not supported')
        ? 'sdk-range-invalid'
        : 'sdk-incompatible',
      message: compatibility.reason ?? 'Extension SDK range is not compatible with this host.',
    },
  ]
}

async function discoverPackage(
  root: ExtensionDiscoveryRoot,
  packageDirectoryName: string,
  hostSdkVersion: string,
): Promise<DiscoveredExtensionPackage> {
  const packagePath = path.join(root.rootPath, packageDirectoryName)
  const manifestPath = getManifestPath(packagePath)
  const manifestResult = await loadExtensionManifest(manifestPath)
  const baseDiagnostics = [...manifestResult.diagnostics]

  if (!manifestResult.manifest || !manifestResult.rawManifest) {
    return {
      id: packageDirectoryName,
      scope: root.scope,
      packagePath,
      manifestPath,
      manifest: null,
      buildPlan: null,
      contentHash: null,
      sdkCompatibility: null,
      diagnostics: baseDiagnostics,
    }
  }

  if (manifestResult.manifest.id !== packageDirectoryName) {
    baseDiagnostics.push({
      severity: 'error',
      code: 'manifest-id-mismatch',
      message: `Manifest id "${manifestResult.manifest.id}" must match extension directory "${packageDirectoryName}".`,
      path: manifestPath,
    })
  }

  const sourceDiagnostics = await validateDeclaredFiles({
    packagePath,
    relativePaths: manifestResult.manifest.sourceFiles,
    label: OPENWAGGLE_EXTENSION.LABELS.SOURCE_FILE,
    missingCode: 'source-file-missing',
  })
  const artifactDiagnostics = await validateDeclaredFiles({
    packagePath,
    relativePaths: manifestResult.manifest.builtArtifacts,
    label: OPENWAGGLE_EXTENSION.LABELS.BUILT_ARTIFACT,
    missingCode: 'built-artifact-missing',
  })
  const contentHash = await calculateContentHash(
    packagePath,
    manifestResult.rawManifest,
    getManifestContentHashInput(manifestResult.manifest),
  )
  const sdkCompatibility = getSdkCompatibility(
    manifestResult.manifest.sdk.openwaggle,
    hostSdkVersion,
  )
  const buildPlan = await getExtensionBuildPlan(
    packagePath,
    manifestResult.rawManifest,
    manifestResult.manifest,
  )
  const runtimeRequirementDiagnostics = await diagnoseRuntimeRequirements(manifestResult.manifest)

  return {
    id: manifestResult.manifest.id,
    scope: root.scope,
    packagePath,
    manifestPath,
    manifest: manifestResult.manifest,
    buildPlan: buildPlan.buildPlan,
    contentHash: contentHash.contentHash,
    sdkCompatibility,
    diagnostics: [
      ...baseDiagnostics,
      ...sourceDiagnostics,
      ...artifactDiagnostics,
      ...contentHash.diagnostics,
      ...buildPlan.diagnostics,
      ...runtimeRequirementDiagnostics,
      ...sdkDiagnostics(sdkCompatibility),
    ],
  }
}

async function discoverRoot(
  root: ExtensionDiscoveryRoot,
  hostSdkVersion: string,
): Promise<readonly DiscoveredExtensionPackage[]> {
  try {
    const packageDirectoryNames = await listPackageDirectories(root.rootPath)
    return Promise.all(
      packageDirectoryNames.map((packageDirectoryName) =>
        discoverPackage(root, packageDirectoryName, hostSdkVersion),
      ),
    )
  } catch (error) {
    return [
      {
        id: path.basename(root.rootPath),
        scope: root.scope,
        packagePath: root.rootPath,
        manifestPath: getManifestPath(root.rootPath),
        manifest: null,
        buildPlan: null,
        contentHash: null,
        sdkCompatibility: null,
        diagnostics: [
          {
            severity: 'error',
            code: 'filesystem-error',
            message: `Failed to discover extension root: ${formatErrorMessage(error)}`,
            path: root.rootPath,
          },
        ],
      },
    ]
  }
}

export async function discoverExtensionPackages(
  options: ExtensionDiscoveryOptions,
): Promise<readonly DiscoveredExtensionPackage[]> {
  const hostSdkVersion = options.hostSdkVersion || OPENWAGGLE_EXTENSION.SDK_VERSION
  const nestedResults = await Promise.all(
    getDiscoveryRoots(options).map((root) => discoverRoot(root, hostSdkVersion)),
  )
  return nestedResults.flat().sort(compareDiscoveredPackages)
}
