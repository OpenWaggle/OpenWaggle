import type { ExtensionPackageSummary } from '@shared/types/extensions'
import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

const HASH_PREVIEW_LENGTH = 12

function formatHash(hash: string | null) {
  return hash ? `${hash.slice(0, HASH_PREVIEW_LENGTH)}…` : 'Not available'
}

function formatInstallSource(extensionPackage: ExtensionPackageSummary) {
  return extensionPackage.buildPlan?.installSource ?? 'prebuilt'
}

function formatBuildStatus(extensionPackage: ExtensionPackageSummary) {
  return extensionPackage.lifecycle?.buildStatus ?? 'not-run'
}

function formatReloadedAt(lastReloadedAt: number | null | undefined) {
  return lastReloadedAt ? new Date(lastReloadedAt).toISOString() : 'Never'
}

function MetadataItem({
  label,
  children,
  valueClassName,
}: {
  readonly label: string
  readonly children: ReactNode
  readonly valueClassName?: string
}) {
  return (
    <div>
      <span className="text-text-muted">{label}</span>
      <div className={cn('text-text-secondary', valueClassName)}>{children}</div>
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
      <MetadataItem label="Version">{manifest?.version ?? 'Unknown'}</MetadataItem>
      <MetadataItem label="SDK range">{manifest?.sdkRange ?? 'Unknown'}</MetadataItem>
      <MetadataItem label="Content hash" valueClassName="font-mono">
        {formatHash(extensionPackage.contentHash)}
      </MetadataItem>
      <MetadataItem label="Contributions">{manifest?.contributionCount ?? 0}</MetadataItem>
      <MetadataItem label="Install source">{formatInstallSource(extensionPackage)}</MetadataItem>
      <MetadataItem label="Build command" valueClassName="truncate">
        {extensionPackage.buildPlan?.command ?? 'Not declared'}
      </MetadataItem>
      {extensionPackage.buildPlan ? (
        <MetadataItem label="Build status" valueClassName="truncate">
          {formatBuildStatus(extensionPackage)}
        </MetadataItem>
      ) : null}
      <MetadataItem label="Last reload" valueClassName="truncate">
        {formatReloadedAt(extensionPackage.lifecycle?.lastReloadedAt)}
      </MetadataItem>
      {extensionPackage.lifecycle?.buildLog ? (
        <MetadataItem label="Build log" valueClassName="truncate font-mono">
          {extensionPackage.lifecycle.buildLog}
        </MetadataItem>
      ) : null}
    </div>
  )
}
