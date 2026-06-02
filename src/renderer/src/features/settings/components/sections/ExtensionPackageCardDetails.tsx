import { match } from '@diegogbrisa/ts-match'
import type { ExtensionDiagnosticView, ExtensionPackageSummary } from '@shared/types/extensions'
import { cn } from '@/shared/lib/cn'

const HASH_PREVIEW_LENGTH = 12
const MAX_VISIBLE_DIAGNOSTICS = 3

function formatHash(hash: string | null) {
  return hash ? `${hash.slice(0, HASH_PREVIEW_LENGTH)}…` : 'Not available'
}

function diagnosticTone(diagnostic: ExtensionDiagnosticView) {
  return match(diagnostic.severity)
    .with('error', () => 'text-error')
    .with('warning', () => 'text-amber-300')
    .exhaustive()
}

export function ExtensionDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: readonly ExtensionDiagnosticView[]
}) {
  if (diagnostics.length === 0) {
    return null
  }

  return (
    <div className="mt-3 space-y-1 rounded-md border border-error/20 bg-error/5 p-2">
      {diagnostics.slice(0, MAX_VISIBLE_DIAGNOSTICS).map((diagnostic) => (
        <div key={`${diagnostic.code}:${diagnostic.message}`} className="text-[11px]">
          <span className={cn('font-medium', diagnosticTone(diagnostic))}>{diagnostic.code}</span>
          <span className="text-text-tertiary"> — {diagnostic.message}</span>
        </div>
      ))}
      {diagnostics.length > MAX_VISIBLE_DIAGNOSTICS ? (
        <div className="text-[11px] text-text-muted">
          {diagnostics.length - MAX_VISIBLE_DIAGNOSTICS} more diagnostics
        </div>
      ) : null}
    </div>
  )
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
    </div>
  )
}

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
