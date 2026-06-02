import type { ExtensionPackageSummary } from '@shared/types/extensions'

export function ManifestBadges({
  extensionPackage,
}: {
  readonly extensionPackage: ExtensionPackageSummary
}) {
  const manifest = extensionPackage.manifest
  if (!manifest) {
    return null
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-text-muted">
      <span>{manifest.sourceFileCount} source files</span>
      <span>{manifest.builtArtifactCount} artifacts</span>
      <span>{manifest.capabilityCount} capabilities</span>
      <span>{manifest.piResourceRootCount} Pi resource roots</span>
      <span>{manifest.runtimeRequirementCount} runtime requirements</span>
    </div>
  )
}
