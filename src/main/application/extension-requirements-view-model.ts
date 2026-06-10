import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionCapabilityRequirementView,
  ExtensionNetworkRequirementView,
  ExtensionPackageRequirementsView,
  ExtensionPrivilegeRequirementView,
  ExtensionRuntimeRequirementView,
} from '@shared/types/extensions'
import type { DiscoveredExtensionPackage } from '../extensions/types'

type ExtensionManifest = NonNullable<DiscoveredExtensionPackage['manifest']>
type ExtensionCapabilityManifestDeclaration = NonNullable<ExtensionManifest['capabilities']>[number]

function runtimeRequirementsToView(
  manifest: ExtensionManifest,
): readonly ExtensionRuntimeRequirementView[] {
  const requirements: ExtensionRuntimeRequirementView[] = []

  for (const requirement of manifest.runtimeRequirements ?? []) {
    if (requirement.binary !== undefined) {
      requirements.push({
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.RUNTIME_BINARY,
        id: requirement.id,
        label: requirement.label,
        binary: requirement.binary,
      })
      continue
    }

    if (requirement.command !== undefined) {
      requirements.push({
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.RUNTIME_COMMAND,
        id: requirement.id,
        label: requirement.label,
        path: requirement.command,
      })
    }
  }

  return requirements
}

function capabilityRequirementToView(
  capability: ExtensionCapabilityManifestDeclaration,
): ExtensionCapabilityRequirementView {
  return {
    kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_CAPABILITY,
    id: capability.id,
    label: `Capability: ${capability.id}`,
    grantId: capability.id,
    capabilityId: capability.id,
    ...(capability.methods !== undefined ? { methods: capability.methods } : {}),
    ...(capability.scopes !== undefined ? { scopes: capability.scopes } : {}),
  }
}

function networkRequirementToView(
  origins: readonly string[],
): ExtensionNetworkRequirementView | null {
  if (origins.length === 0) {
    return null
  }

  return {
    kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_NETWORK,
    id: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.NETWORK,
    label: 'Network access',
    grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.NETWORK,
    origins,
  }
}

function localBuildRequirementToView(
  extensionPackage: DiscoveredExtensionPackage,
): ExtensionPrivilegeRequirementView | null {
  const manifest = extensionPackage.manifest
  const requiresLocalBuild =
    extensionPackage.buildPlan?.approvalRequired === true ||
    manifest?.install?.source === OPENWAGGLE_EXTENSION.INSTALL_SOURCE.LOCAL_BUILD

  if (!requiresLocalBuild) {
    return null
  }

  return {
    kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_LOCAL_BUILD,
    id: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.LOCAL_BUILD,
    label: 'Local build step',
    grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.LOCAL_BUILD,
    command: extensionPackage.buildPlan?.command ?? manifest?.build?.command ?? null,
    outputCount:
      extensionPackage.buildPlan?.outputPaths.length ?? manifest?.builtArtifacts.length ?? 0,
  }
}

function trustedRuntimeRequirementsToView(
  manifest: ExtensionManifest,
): readonly ExtensionPrivilegeRequirementView[] {
  const requirements: ExtensionPrivilegeRequirementView[] = []

  if (manifest.trusted?.main !== undefined) {
    requirements.push({
      kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_TRUSTED_MAIN,
      id: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_MAIN,
      label: 'Trusted main-process runtime',
      grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_MAIN,
      path: manifest.trusted.main,
    })
  }
  if (manifest.trusted?.renderer !== undefined) {
    requirements.push({
      kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_TRUSTED_RENDERER,
      id: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_RENDERER,
      label: 'Trusted renderer runtime',
      grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_RENDERER,
      path: manifest.trusted.renderer,
    })
  }

  return requirements
}

function privilegeRequirementsToView(
  extensionPackage: DiscoveredExtensionPackage,
): readonly ExtensionPrivilegeRequirementView[] {
  const manifest = extensionPackage.manifest
  if (!manifest) {
    return []
  }

  const requirements: ExtensionPrivilegeRequirementView[] = []
  for (const capability of manifest.capabilities ?? []) {
    requirements.push(capabilityRequirementToView(capability))
  }

  const networkRequirement = networkRequirementToView(manifest.network?.origins ?? [])
  if (networkRequirement) {
    requirements.push(networkRequirement)
  }

  const localBuildRequirement = localBuildRequirementToView(extensionPackage)
  if (localBuildRequirement) {
    requirements.push(localBuildRequirement)
  }

  requirements.push(...trustedRuntimeRequirementsToView(manifest))
  return requirements
}

export function requirementsToView(
  extensionPackage: DiscoveredExtensionPackage,
): ExtensionPackageRequirementsView {
  if (!extensionPackage.manifest) {
    return {
      runtime: [],
      privileges: [],
    }
  }

  return {
    runtime: runtimeRequirementsToView(extensionPackage.manifest),
    privileges: privilegeRequirementsToView(extensionPackage),
  }
}
