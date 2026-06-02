import type { ExtensionPackageSummary } from '@shared/types/extensions'

const HASH_PREVIEW_LENGTH = 12

function formatHash(hash: string | null) {
  return hash ? `${hash.slice(0, HASH_PREVIEW_LENGTH)}…` : 'Not available'
}

function formatInstallSource(extensionPackage: ExtensionPackageSummary) {
  return extensionPackage.buildPlan?.installSource ?? 'prebuilt'
}

export function PackageMetadata({
  extensionPackage,
}: {
  readonly extensionPackage: ExtensionPackageSummary
}) {
  const manifest = extensionPackage.manifest
  return (
    <div className="mt-4 grid gap-3 text-[12px] text-text-tertiary md:grid-cols-2">
      <div>
        <span className="text-text-muted">Version</span>
        <div className="text-text-secondary">{manifest?.version ?? 'Unknown'}</div>
      </div>
      <div>
        <span className="text-text-muted">SDK range</span>
        <div className="text-text-secondary">{manifest?.sdkRange ?? 'Unknown'}</div>
      </div>
      <div>
        <span className="text-text-muted">Content hash</span>
        <div className="font-mono text-text-secondary">
          {formatHash(extensionPackage.contentHash)}
        </div>
      </div>
      <div>
        <span className="text-text-muted">Contributions</span>
        <div className="text-text-secondary">{manifest?.contributionCount ?? 0}</div>
      </div>
      <div>
        <span className="text-text-muted">Install source</span>
        <div className="text-text-secondary">{formatInstallSource(extensionPackage)}</div>
      </div>
      <div>
        <span className="text-text-muted">Build command</span>
        <div className="truncate text-text-secondary">
          {extensionPackage.buildPlan?.command ?? 'Not declared'}
        </div>
      </div>
    </div>
  )
}
