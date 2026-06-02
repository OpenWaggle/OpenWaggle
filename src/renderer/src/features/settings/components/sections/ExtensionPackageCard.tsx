import { match } from '@diegogbrisa/ts-match'
import type { ExtensionDiagnosticView, ExtensionPackageSummary } from '@shared/types/extensions'
import { AlertTriangle, PackageOpen, ShieldCheck } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

const HASH_PREVIEW_LENGTH = 12
const MAX_VISIBLE_DIAGNOSTICS = 3
type StatusPillTone = 'neutral' | 'good' | 'warning' | 'error'

function StatusPill({
  children,
  tone,
}: {
  readonly children: string
  readonly tone: StatusPillTone
}) {
  const toneClassName = match(tone)
    .with('good', () => 'bg-emerald-500/10 text-emerald-300')
    .with('warning', () => 'bg-amber-500/10 text-amber-300')
    .with('error', () => 'bg-error/10 text-error')
    .with('neutral', () => 'bg-bg-tertiary text-text-tertiary')
    .exhaustive()

  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', toneClassName)}>
      {children}
    </span>
  )
}

function packageTitle(extensionPackage: ExtensionPackageSummary) {
  return extensionPackage.manifest?.name ?? extensionPackage.id
}

function formatHash(hash: string | null) {
  return hash ? `${hash.slice(0, HASH_PREVIEW_LENGTH)}…` : 'Not available'
}

function diagnosticTone(diagnostic: ExtensionDiagnosticView) {
  return match(diagnostic.severity)
    .with('error', () => 'text-error')
    .with('warning', () => 'text-amber-300')
    .exhaustive()
}

function ExtensionDiagnostics({
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

function hasErrorDiagnostics(extensionPackage: ExtensionPackageSummary) {
  return extensionPackage.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
}

function isSdkCompatible(extensionPackage: ExtensionPackageSummary) {
  return extensionPackage.sdkCompatibility?.compatible ?? false
}

function PackageStatusPills({
  extensionPackage,
}: {
  readonly extensionPackage: ExtensionPackageSummary
}) {
  const lifecycle = extensionPackage.lifecycle
  const hasErrors = hasErrorDiagnostics(extensionPackage)
  const sdkCompatible = isSdkCompatible(extensionPackage)

  return (
    <>
      <StatusPill tone="neutral">{extensionPackage.scope.label}</StatusPill>
      <StatusPill tone={lifecycle?.enabled ? 'good' : 'neutral'}>
        {lifecycle?.enabled ? 'Enabled' : 'Disabled'}
      </StatusPill>
      <StatusPill tone={lifecycle?.trusted ? 'good' : 'warning'}>
        {lifecycle?.trusted ? 'Trusted' : 'Untrusted'}
      </StatusPill>
      <StatusPill tone={hasErrors ? 'error' : sdkCompatible ? 'good' : 'warning'}>
        {hasErrors ? 'Invalid' : sdkCompatible ? 'SDK compatible' : 'SDK blocked'}
      </StatusPill>
    </>
  )
}

function canEnablePackage(extensionPackage: ExtensionPackageSummary) {
  return (
    extensionPackage.lifecycle?.trusted === true &&
    extensionPackage.manifest !== null &&
    extensionPackage.contentHash !== null &&
    isSdkCompatible(extensionPackage) &&
    !hasErrorDiagnostics(extensionPackage)
  )
}

function disabledEnableReason(extensionPackage: ExtensionPackageSummary) {
  if (extensionPackage.lifecycle?.trusted !== true) {
    return 'Trust this extension before enabling it.'
  }
  if (extensionPackage.manifest === null) {
    return 'Cannot enable an extension with an invalid manifest.'
  }
  if (extensionPackage.contentHash === null) {
    return 'Cannot enable an extension without a content hash.'
  }
  if (!isSdkCompatible(extensionPackage)) {
    return 'Cannot enable an extension with an incompatible SDK range.'
  }
  if (hasErrorDiagnostics(extensionPackage)) {
    return 'Cannot enable an extension with error diagnostics.'
  }
  return undefined
}

function PackageTrustIcon({
  extensionPackage,
}: {
  readonly extensionPackage: ExtensionPackageSummary
}) {
  return extensionPackage.lifecycle?.trusted ? (
    <ShieldCheck className="size-4 shrink-0 text-emerald-300" />
  ) : (
    <AlertTriangle className="size-4 shrink-0 text-amber-300" />
  )
}

function PackageActions({
  extensionPackage,
  busy,
  onSetTrusted,
  onSetEnabled,
}: {
  readonly extensionPackage: ExtensionPackageSummary
  readonly busy: boolean
  readonly onSetTrusted: (trusted: boolean) => void
  readonly onSetEnabled: (enabled: boolean) => void
}) {
  const trusted = extensionPackage.lifecycle?.trusted === true
  const enabled = extensionPackage.lifecycle?.enabled === true
  const enableAllowed = enabled || canEnablePackage(extensionPackage)
  const title = enabled ? undefined : disabledEnableReason(extensionPackage)

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Button
        size="xs"
        variant={trusted ? 'secondary' : 'accent'}
        disabled={busy}
        onClick={() => onSetTrusted(!trusted)}
        aria-label={`${trusted ? 'Untrust' : 'Trust'} ${packageTitle(extensionPackage)}`}
      >
        {busy ? 'Saving…' : trusted ? 'Untrust' : 'Trust'}
      </Button>
      <Button
        size="xs"
        variant={enabled ? 'secondary' : 'accent'}
        disabled={busy || !enableAllowed}
        onClick={() => onSetEnabled(!enabled)}
        aria-label={`${enabled ? 'Disable' : 'Enable'} ${packageTitle(extensionPackage)}`}
        title={title}
      >
        {enabled ? 'Disable' : 'Enable'}
      </Button>
    </div>
  )
}

function PackageMetadata({
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

function ManifestBadges({
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

export function ExtensionPackageCard({
  extensionPackage,
  busy,
  onSetTrusted,
  onSetEnabled,
}: {
  readonly extensionPackage: ExtensionPackageSummary
  readonly busy: boolean
  readonly onSetTrusted: (trusted: boolean) => void
  readonly onSetEnabled: (enabled: boolean) => void
}) {
  return (
    <div className="rounded-lg border border-border bg-[#111418] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PackageOpen className="size-4 text-accent" />
            <h3 className="text-[15px] font-semibold text-text-primary">
              {packageTitle(extensionPackage)}
            </h3>
            <PackageStatusPills extensionPackage={extensionPackage} />
          </div>
          <div className="mt-1 truncate text-[12px] text-text-muted">
            {extensionPackage.packagePath}
          </div>
        </div>
        <PackageTrustIcon extensionPackage={extensionPackage} />
      </div>
      <PackageMetadata extensionPackage={extensionPackage} />
      <PackageActions
        extensionPackage={extensionPackage}
        busy={busy}
        onSetTrusted={onSetTrusted}
        onSetEnabled={onSetEnabled}
      />
      <ManifestBadges extensionPackage={extensionPackage} />
      <ExtensionDiagnostics diagnostics={extensionPackage.diagnostics} />
    </div>
  )
}
