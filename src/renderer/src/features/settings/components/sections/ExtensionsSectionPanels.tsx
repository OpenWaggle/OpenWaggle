import { match } from '@diegogbrisa/ts-match'
import type { ExtensionDiagnosticView, ExtensionPackageSummary } from '@shared/types/extensions'
import { AlertTriangle, PackageOpen, RefreshCw, ShieldCheck } from 'lucide-react'
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

export function ExtensionsSectionHeading({
  projectPath,
  loading,
  onRefresh,
}: {
  readonly projectPath: string | null
  readonly loading: boolean
  readonly onRefresh: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <h2 className="text-[20px] font-semibold text-text-primary">Extensions</h2>
        <p className="max-w-[760px] text-[13px] leading-5 text-text-tertiary">
          Discovered OpenWaggle extension packages. Enablement, trust, and permissions remain
          read-only in this slice.
        </p>
        <p className="text-[11px] text-text-muted">
          {projectPath
            ? `Project scope: ${projectPath}`
            : 'No project selected; showing global scope only.'}
        </p>
      </div>
      <Button disabled={loading} onClick={onRefresh} leftIcon={<RefreshCw className="size-3" />}>
        Refresh
      </Button>
    </div>
  )
}

export function ExtensionsErrorAlert({ message }: { readonly message: string | null }) {
  if (!message) {
    return null
  }

  return (
    <p
      role="alert"
      className="rounded-lg border border-error/25 bg-error/6 px-3 py-2 text-sm text-error"
    >
      {message}
    </p>
  )
}

function PackageStatusPills({
  extensionPackage,
}: {
  readonly extensionPackage: ExtensionPackageSummary
}) {
  const lifecycle = extensionPackage.lifecycle
  const hasErrors = extensionPackage.diagnostics.some(
    (diagnostic) => diagnostic.severity === 'error',
  )
  const sdkCompatible = extensionPackage.sdkCompatibility?.compatible ?? false

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
}: {
  readonly extensionPackage: ExtensionPackageSummary
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
      <ManifestBadges extensionPackage={extensionPackage} />
      <ExtensionDiagnostics diagnostics={extensionPackage.diagnostics} />
    </div>
  )
}
