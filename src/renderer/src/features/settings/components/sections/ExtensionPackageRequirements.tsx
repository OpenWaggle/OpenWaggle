import { match } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionPackageRequirementsView,
  ExtensionPrivilegeRequirementView,
  ExtensionRuntimeRequirementView,
} from '@shared/types/extensions'
import { AlertTriangle, CheckCircle2, TerminalSquare } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

function valueList(values: readonly string[]) {
  return values.length > 0 ? values.join(', ') : 'Not specified'
}

function RuntimeRequirement({
  requirement,
}: {
  readonly requirement: ExtensionRuntimeRequirementView
}) {
  const detail = match(requirement)
    .with(
      { kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.RUNTIME_BINARY },
      (value) => `Binary: ${value.binary}`,
    )
    .with(
      { kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.RUNTIME_COMMAND },
      (value) => `Command: ${value.path}`,
    )
    .exhaustive()

  return (
    <li className="rounded-md border border-border/70 bg-bg-tertiary/40 px-3 py-2">
      <div className="flex items-start gap-2">
        <TerminalSquare className="mt-0.5 size-3.5 shrink-0 text-text-tertiary" />
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-text-secondary">{requirement.label}</div>
          <div className="mt-0.5 text-[11px] text-text-muted">{detail}</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            Diagnostic only · OpenWaggle does not install this automatically
          </div>
        </div>
      </div>
    </li>
  )
}

function privilegeDetail(requirement: ExtensionPrivilegeRequirementView) {
  return match(requirement)
    .with(
      { kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_CAPABILITY },
      (value) =>
        `Capability ${value.capabilityId}; methods ${valueList(value.methods ?? [])}; scopes ${valueList(value.scopes ?? [])}`,
    )
    .with(
      { kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_NETWORK },
      (value) => `Origins ${valueList(value.origins)}; access ${valueList(value.accessModes)}`,
    )
    .with(
      { kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_LOCAL_BUILD },
      (value) =>
        `Build command ${value.command ?? 'not declared'}; outputs ${String(value.outputCount)}`,
    )
    .with(
      { kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_TRUSTED_MAIN },
      (value) => `Main-process entry ${value.path}`,
    )
    .with(
      { kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_TRUSTED_RENDERER },
      (value) => `Trusted renderer entry ${value.path}`,
    )
    .exhaustive()
}

function PrivilegeRequirement({
  requirement,
}: {
  readonly requirement: ExtensionPrivilegeRequirementView
}) {
  const granted = requirement.granted
  return (
    <li className="rounded-md border border-border/70 bg-bg-tertiary/40 px-3 py-2">
      <div className="flex items-start gap-2">
        {granted ? (
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
        ) : (
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-medium text-text-secondary">{requirement.label}</span>
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-medium',
                granted ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300',
              )}
            >
              {granted ? 'Granted' : 'Needs consent'}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-text-muted">{privilegeDetail(requirement)}</div>
        </div>
      </div>
    </li>
  )
}

export function ExtensionPackageRequirements({
  requirements,
}: {
  readonly requirements: ExtensionPackageRequirementsView | undefined
}) {
  if (
    !requirements ||
    (requirements.privileges.length === 0 && requirements.runtime.length === 0)
  ) {
    return null
  }

  return (
    <section className="mt-4 rounded-lg border border-border bg-bg-secondary/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-[12px] font-semibold text-text-secondary">Extension requirements</h4>
          <p className="mt-1 text-[11px] text-text-muted">
            Review these before trusting this package. Trust grants permissions for the current
            content hash only.
          </p>
        </div>
        {requirements.consentRequired ? (
          <span className="rounded bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-300">
            {requirements.missingGrantIds.length} consent pending
          </span>
        ) : null}
      </div>

      {requirements.privileges.length > 0 ? (
        <ul className="mt-3 space-y-2" aria-label="Privileged extension requirements">
          {requirements.privileges.map((requirement) => (
            <PrivilegeRequirement
              key={`${requirement.kind}:${requirement.id}`}
              requirement={requirement}
            />
          ))}
        </ul>
      ) : null}

      {requirements.runtime.length > 0 ? (
        <ul className="mt-3 space-y-2" aria-label="Runtime extension requirements">
          {requirements.runtime.map((requirement) => (
            <RuntimeRequirement
              key={`${requirement.kind}:${requirement.id}`}
              requirement={requirement}
            />
          ))}
        </ul>
      ) : null}
    </section>
  )
}
