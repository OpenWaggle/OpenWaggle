import { match } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionPackageSummary,
  ExtensionProjectOverrideView,
} from '@shared/types/extensions'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import {
  hasErrorDiagnostics,
  isBuildPlanApproved,
  isSdkCompatible,
} from './extension-package-card-model'

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

function projectOverridePill(
  projectOverride: ExtensionProjectOverrideView | null,
): { readonly tone: StatusPillTone; readonly label: string } | null {
  if (!projectOverride) {
    return null
  }

  return projectOverride.disabled
    ? {
        tone: 'warning',
        label: OPENWAGGLE_EXTENSION.PROJECT_OVERRIDE.DISABLED_LABEL,
      }
    : {
        tone: 'neutral',
        label: OPENWAGGLE_EXTENSION.PROJECT_OVERRIDE.ACTIVE_LABEL,
      }
}

function projectOverridesSummaryPill(
  extensionPackage: ExtensionPackageSummary,
): { readonly tone: StatusPillTone; readonly label: string } | null {
  if (extensionPackage.projectOverride || extensionPackage.projectOverrides.length === 0) {
    return null
  }

  const disabledCount = extensionPackage.projectOverrides.filter(
    (projectOverride) => projectOverride.disabled,
  ).length
  if (disabledCount === 0) {
    return { tone: 'neutral', label: 'All projects active' }
  }

  return {
    tone: 'warning',
    label: `${disabledCount} project opt-out${disabledCount === 1 ? '' : 's'}`,
  }
}

function sdkStatusPill(extensionPackage: ExtensionPackageSummary): {
  readonly tone: StatusPillTone
  readonly label: string
} {
  if (hasErrorDiagnostics(extensionPackage)) {
    return { tone: 'error', label: 'Invalid' }
  }
  if (isSdkCompatible(extensionPackage)) {
    return { tone: 'good', label: 'SDK compatible' }
  }
  return { tone: 'warning', label: 'SDK blocked' }
}

function ProjectStatusPills({
  extensionPackage,
}: {
  readonly extensionPackage: ExtensionPackageSummary
}) {
  const projectStatus = projectOverridePill(extensionPackage.projectOverride)
  const projectSummaryStatus = projectOverridesSummaryPill(extensionPackage)

  return (
    <>
      {projectStatus ? (
        <StatusPill tone={projectStatus.tone}>{projectStatus.label}</StatusPill>
      ) : null}
      {projectSummaryStatus ? (
        <StatusPill tone={projectSummaryStatus.tone}>{projectSummaryStatus.label}</StatusPill>
      ) : null}
    </>
  )
}

function LifecycleStatusPills({
  lifecycle,
}: {
  readonly lifecycle: ExtensionPackageSummary['lifecycle']
}) {
  return (
    <>
      <StatusPill tone={lifecycle?.enabled ? 'good' : 'neutral'}>
        {lifecycle?.enabled ? 'Enabled' : 'Disabled'}
      </StatusPill>
      <StatusPill tone={lifecycle?.trusted ? 'good' : 'warning'}>
        {lifecycle?.trusted ? 'Trusted' : 'Untrusted'}
      </StatusPill>
      {lifecycle?.updateAvailable ? (
        <StatusPill tone="warning">
          {OPENWAGGLE_EXTENSION.LIFECYCLE.UPDATE_AVAILABLE_LABEL}
        </StatusPill>
      ) : null}
    </>
  )
}

function BuildStatusPill({
  extensionPackage,
}: {
  readonly extensionPackage: ExtensionPackageSummary
}) {
  if (!extensionPackage.buildPlan?.approvalRequired) {
    return null
  }

  if (extensionPackage.lifecycle?.buildStatus === OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.FAILED) {
    return <StatusPill tone="error">{OPENWAGGLE_EXTENSION.LIFECYCLE.BUILD_FAILED_LABEL}</StatusPill>
  }

  const succeeded = isBuildPlanApproved(extensionPackage)
  return (
    <StatusPill tone={succeeded ? 'good' : 'warning'}>
      {succeeded
        ? OPENWAGGLE_EXTENSION.LIFECYCLE.BUILD_SUCCEEDED_LABEL
        : OPENWAGGLE_EXTENSION.LIFECYCLE.BUILD_APPROVAL_REQUIRED_LABEL}
    </StatusPill>
  )
}

export function PackageStatusPills({
  extensionPackage,
}: {
  readonly extensionPackage: ExtensionPackageSummary
}) {
  const lifecycle = extensionPackage.lifecycle
  const sdkStatus = sdkStatusPill(extensionPackage)

  return (
    <>
      <StatusPill tone="neutral">{extensionPackage.scope.label}</StatusPill>
      <ProjectStatusPills extensionPackage={extensionPackage} />
      <LifecycleStatusPills lifecycle={lifecycle} />
      <BuildStatusPill extensionPackage={extensionPackage} />
      <StatusPill tone={sdkStatus.tone}>{sdkStatus.label}</StatusPill>
    </>
  )
}

export function PackageTrustIcon({
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
