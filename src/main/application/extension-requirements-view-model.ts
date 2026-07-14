import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionCapabilityRequirementView,
  ExtensionNetworkAccessMode,
  ExtensionNetworkRequirementView,
  ExtensionPackageRequirementsView,
  ExtensionPrivilegeRequirementView,
  ExtensionRuntimeRequirementView,
} from '@shared/types/extensions'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../extensions/types'

type ExtensionManifest = NonNullable<DiscoveredExtensionPackage['manifest']>
type ExtensionCapabilityManifestDeclaration = NonNullable<ExtensionManifest['capabilities']>[number]

function grantIsCurrent(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState | null
  readonly grantId: string
}) {
  return (
    input.lifecycle?.trusted === true &&
    input.extensionPackage.contentHash !== null &&
    input.lifecycle.contentHash === input.extensionPackage.contentHash &&
    input.lifecycle.grantedCapabilities.includes(input.grantId)
  )
}

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
        resolution: OPENWAGGLE_EXTENSION.RUNTIME_REQUIREMENT_RESOLUTION.DIAGNOSTIC_ONLY,
        binary: requirement.binary,
      })
      continue
    }

    if (requirement.command !== undefined) {
      requirements.push({
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.RUNTIME_COMMAND,
        id: requirement.id,
        label: requirement.label,
        resolution: OPENWAGGLE_EXTENSION.RUNTIME_REQUIREMENT_RESOLUTION.DIAGNOSTIC_ONLY,
        path: requirement.command,
      })
    }
  }

  return requirements
}

function capabilityRequirementToView(
  extensionPackage: DiscoveredExtensionPackage,
  lifecycle: ExtensionLifecycleState | null,
  capability: ExtensionCapabilityManifestDeclaration,
): ExtensionCapabilityRequirementView {
  return {
    kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_CAPABILITY,
    id: capability.id,
    label: `Capability: ${capability.id}`,
    grantId: capability.id,
    consentRequired: true,
    granted: grantIsCurrent({ extensionPackage, lifecycle, grantId: capability.id }),
    capabilityId: capability.id,
    ...(capability.methods !== undefined ? { methods: capability.methods } : {}),
    ...(capability.scopes !== undefined ? { scopes: capability.scopes } : {}),
  }
}

function hasEntries(entries: readonly unknown[] | undefined) {
  return entries !== undefined && entries.length > 0
}

function hasVisualContributions(manifest: ExtensionManifest) {
  const contributions = manifest.contributions
  if (!contributions) {
    return false
  }

  return (
    hasEntries(contributions.routes) ||
    hasEntries(contributions.settingsSections) ||
    hasEntries(contributions.sidePanels) ||
    hasEntries(contributions.dialogs) ||
    hasEntries(contributions.transcriptRenderers) ||
    hasEntries(contributions.toolRenderers) ||
    hasEntries(contributions.customMessageRenderers) ||
    hasEntries(contributions.interactionRenderers) ||
    hasEntries(contributions.statusWidgets)
  )
}

function uniqueNetworkAccessModes(
  modes: readonly ExtensionNetworkAccessMode[],
): readonly ExtensionNetworkAccessMode[] {
  const uniqueModes: ExtensionNetworkAccessMode[] = []
  const seenModes = new Set<ExtensionNetworkAccessMode>()
  for (const mode of modes) {
    if (!seenModes.has(mode)) {
      seenModes.add(mode)
      uniqueModes.push(mode)
    }
  }
  return uniqueModes
}

function networkAccessModes(manifest: ExtensionManifest): readonly ExtensionNetworkAccessMode[] {
  const modes: ExtensionNetworkAccessMode[] = []

  if (manifest.trusted?.main !== undefined || manifest.trusted?.renderer !== undefined) {
    modes.push(OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE.DIRECT)
  }
  if (hasVisualContributions(manifest)) {
    modes.push(OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE.RESTRICTED)
  }
  if (modes.length === 0) {
    modes.push(OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE.BROKERED)
  }

  return uniqueNetworkAccessModes(modes)
}

function networkRequirementToView(
  extensionPackage: DiscoveredExtensionPackage,
  lifecycle: ExtensionLifecycleState | null,
  manifest: ExtensionManifest,
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
    consentRequired: true,
    granted: grantIsCurrent({
      extensionPackage,
      lifecycle,
      grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.NETWORK,
    }),
    origins,
    accessModes: networkAccessModes(manifest),
  }
}

function localBuildRequirementToView(
  extensionPackage: DiscoveredExtensionPackage,
  lifecycle: ExtensionLifecycleState | null,
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
    consentRequired: true,
    granted: grantIsCurrent({
      extensionPackage,
      lifecycle,
      grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.LOCAL_BUILD,
    }),
    command: extensionPackage.buildPlan?.command ?? manifest?.build?.command ?? null,
    outputCount:
      extensionPackage.buildPlan?.outputPaths.length ?? manifest?.builtArtifacts.length ?? 0,
  }
}

function trustedRuntimeRequirementsToView(
  extensionPackage: DiscoveredExtensionPackage,
  lifecycle: ExtensionLifecycleState | null,
  manifest: ExtensionManifest,
): readonly ExtensionPrivilegeRequirementView[] {
  const requirements: ExtensionPrivilegeRequirementView[] = []

  if (manifest.trusted?.main !== undefined) {
    requirements.push({
      kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_TRUSTED_MAIN,
      id: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_MAIN,
      label: 'Trusted main-process runtime',
      grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_MAIN,
      consentRequired: true,
      granted: grantIsCurrent({
        extensionPackage,
        lifecycle,
        grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_MAIN,
      }),
      path: manifest.trusted.main,
    })
  }
  if (manifest.trusted?.renderer !== undefined) {
    requirements.push({
      kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_TRUSTED_RENDERER,
      id: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_RENDERER,
      label: 'Trusted renderer runtime',
      grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_RENDERER,
      consentRequired: true,
      granted: grantIsCurrent({
        extensionPackage,
        lifecycle,
        grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_RENDERER,
      }),
      path: manifest.trusted.renderer,
    })
  }

  return requirements
}

function privilegeRequirementsToView(
  extensionPackage: DiscoveredExtensionPackage,
  lifecycle: ExtensionLifecycleState | null,
): readonly ExtensionPrivilegeRequirementView[] {
  const manifest = extensionPackage.manifest
  if (!manifest) {
    return []
  }

  const requirements: ExtensionPrivilegeRequirementView[] = []
  for (const capability of manifest.capabilities ?? []) {
    requirements.push(capabilityRequirementToView(extensionPackage, lifecycle, capability))
  }

  const networkRequirement = networkRequirementToView(
    extensionPackage,
    lifecycle,
    manifest,
    manifest.network?.origins ?? [],
  )
  if (networkRequirement) {
    requirements.push(networkRequirement)
  }

  const localBuildRequirement = localBuildRequirementToView(extensionPackage, lifecycle)
  if (localBuildRequirement) {
    requirements.push(localBuildRequirement)
  }

  requirements.push(...trustedRuntimeRequirementsToView(extensionPackage, lifecycle, manifest))
  return requirements
}

export function requirementsToView(
  extensionPackage: DiscoveredExtensionPackage,
  lifecycle: ExtensionLifecycleState | null = null,
): ExtensionPackageRequirementsView {
  if (!extensionPackage.manifest) {
    return {
      runtime: [],
      privileges: [],
      consentRequired: false,
      missingGrantIds: [],
    }
  }

  const privileges = privilegeRequirementsToView(extensionPackage, lifecycle)
  const missingGrantIds: string[] = []
  for (const requirement of privileges) {
    if (!requirement.granted) {
      missingGrantIds.push(requirement.grantId)
    }
  }

  return {
    runtime: runtimeRequirementsToView(extensionPackage.manifest),
    privileges,
    consentRequired: privileges.length > 0,
    missingGrantIds,
  }
}
