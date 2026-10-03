import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistration } from '@shared/schemas/extensions'
import type { DiscoveredExtensionPackage, ExtensionDiagnostic } from '../extensions/types'
import { contributionDiagnostic } from './extension-contribution-authorization-model'

function normalizedIconPath(relativePath: string) {
  return relativePath.replaceAll(
    OPENWAGGLE_EXTENSION.PATH.WINDOWS_SEPARATOR,
    OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR,
  )
}

function manifestDeclaredSvgIconPaths(extensionPackage: DiscoveredExtensionPackage) {
  const paths = new Set<string>()
  for (const sidePanel of extensionPackage.manifest?.contributions?.sidePanels ?? []) {
    if (typeof sidePanel.icon === 'object') paths.add(normalizedIconPath(sidePanel.icon.svg))
  }
  return paths
}

/**
 * Only SVG files named in the manifest are part of the package content hash, which is what the
 * icon resolver caches by. A dynamically registered side panel may therefore use a Lucide name or
 * an SVG file that a manifest side panel declares, but not an SVG file named only at runtime.
 */
export function runtimeSidePanelIconDiagnostics(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly registration: ExtensionContributionRegistration
}): readonly ExtensionDiagnostic[] {
  const { registration } = input
  if (registration.family !== OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS) return []
  const icon = registration.contribution.icon
  if (icon === undefined || typeof icon === 'string') return []
  if (manifestDeclaredSvgIconPaths(input.extensionPackage).has(normalizedIconPath(icon.svg))) {
    return []
  }
  return [
    contributionDiagnostic({
      extensionPackage: input.extensionPackage,
      family: registration.family,
      contributionId: registration.contribution.id,
      message: `Dynamically registered side panels can only use an SVG icon that a side panel in the extension manifest declares; "${icon.svg}" is not declared. Use a Lucide icon name or declare the file in the manifest.`,
    }),
  ]
}
