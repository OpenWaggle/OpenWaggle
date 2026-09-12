import { match } from '@diegogbrisa/ts-match'
import { BROWSER_IMPORT_FAILURE_COPY } from '@shared/types/browser-import'
import { Check, ExternalLink, ShieldCheck } from 'lucide-react'
import type { BrowserImportWizardController } from '@/features/settings/hooks/useBrowserImportWizard'
import {
  type BrowserImportWizardStep,
  browserImportBlockedAction,
  formatSkippedDomains,
  fullDiskAccessRecheckStep,
  refreshedBrowserImportSourceStep,
} from '@/features/settings/lib/browser-import-wizard-logic'
import { Button } from '@/shared/ui/Button'
import { Spinner } from '@/shared/ui/Spinner'
import {
  cookieResultLabel,
  WizardDialogFooter,
  WizardDialogHeader,
} from './BrowserImportWizardPrimitives'

interface WizardStepProps {
  readonly headingId: string
  readonly model: BrowserImportWizardController
}

export function BrowserImportQuitStep({ headingId, model }: WizardStepProps) {
  return (
    <>
      <WizardDialogHeader
        headingId={headingId}
        title={`Quit ${model.source.name} to import`}
        description={`${model.source.name} is open, so its cookie database cannot be read safely. Quit it, then check again.`}
      />
      <WizardDialogFooter>
        <Button onClick={model.requestClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => model.recheckSource('browser', refreshedBrowserImportSourceStep)}
        >
          I have quit it
        </Button>
      </WizardDialogFooter>
    </>
  )
}

export function BrowserImportFullDiskAccessStep({
  headingId,
  model,
  current,
}: WizardStepProps & {
  readonly current: Extract<BrowserImportWizardStep, { readonly step: 'full-disk-access' }>
}) {
  const grantAndContinue = () => {
    model.clearSettingsError()
    match(current.resume)
      .with('import', model.runImport)
      .with('configure', () => model.recheckSource('full-disk-access', fullDiskAccessRecheckStep))
      .exhaustive()
  }

  return (
    <>
      <WizardDialogHeader
        headingId={headingId}
        title={`Let OpenWaggle read ${model.source.name} cookies`}
        description="Turn on Full Disk Access for OpenWaggle, then return here. You can revoke it after the one-time import."
      />
      <div className="rounded-lg border border-border bg-bg px-3 py-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />
          <p
            role={current.checked === true || model.settingsError ? 'status' : undefined}
            className="text-sm text-text-secondary"
          >
            {model.settingsError ??
              (current.checked
                ? 'Full Disk Access is still required. If you just enabled it, quit and reopen OpenWaggle, then try again.'
                : 'OpenWaggle only reads the selected cookie store. Your source browser data is never changed.')}
          </p>
        </div>
      </div>
      <WizardDialogFooter>
        <Button onClick={model.requestClose}>Cancel</Button>
        <Button disabled={model.openingSettings} onClick={model.openFullDiskAccessSettings}>
          <ExternalLink className="size-3.5" />
          {model.openingSettings ? 'Opening…' : 'Open System Settings'}
        </Button>
        <Button variant="primary" onClick={grantAndContinue}>
          I have turned it on
        </Button>
      </WizardDialogFooter>
    </>
  )
}

export function BrowserImportCheckingStep({
  headingId,
  model,
  current,
}: WizardStepProps & {
  readonly current: Extract<BrowserImportWizardStep, { readonly step: 'checking' }>
}) {
  const checkingAccess = current.check === 'full-disk-access'
  return (
    <>
      <WizardDialogHeader
        headingId={headingId}
        title={`Checking ${model.source.name}`}
        description={
          checkingAccess ? 'Checking Full Disk Access.' : 'Checking whether the browser has closed.'
        }
      />
      <div className="flex items-center gap-3 rounded-lg border border-border bg-bg px-3 py-5">
        <Spinner size="sm" />
        <span className="text-sm text-text-tertiary">
          {checkingAccess ? 'Checking access…' : 'Checking browser…'}
        </span>
      </div>
    </>
  )
}

export function BrowserImportImportingStep({ headingId }: { readonly headingId: string }) {
  return (
    <>
      <WizardDialogHeader
        headingId={headingId}
        title="Importing cookies"
        description="Keep OpenWaggle open while the encrypted cookie store is copied."
      />
      <div className="flex items-center gap-3 rounded-lg border border-border bg-bg px-3 py-5">
        <Spinner size="sm" />
        <span className="text-sm text-text-tertiary">Importing…</span>
      </div>
    </>
  )
}

export function BrowserImportDoneStep({
  headingId,
  model,
  current,
}: WizardStepProps & {
  readonly current: Extract<BrowserImportWizardStep, { readonly step: 'done' }>
}) {
  const title =
    current.imported > 0
      ? `Imported ${cookieResultLabel(current.imported)}`
      : current.skipped > 0
        ? `Skipped ${cookieResultLabel(current.skipped)}`
        : 'No cookies found'
  const description =
    current.imported > 0
      ? `Added to ${current.targetName}.${current.skipped > 0 ? ` ${cookieResultLabel(current.skipped)} skipped.` : ''}`
      : current.skipped > 0
        ? 'No compatible cookies were imported.'
        : 'There were no cookies to import.'

  return (
    <>
      <WizardDialogHeader headingId={headingId} title={title} description={description} />
      {current.createdProfile ? (
        <p className="flex items-center gap-2 rounded-lg border border-success/25 bg-success/8 px-3 py-2 text-sm text-success">
          <Check className="size-3.5" />
          Created the isolated profile {current.targetName}.
        </p>
      ) : null}
      {current.skippedDomains.length > 0 ? (
        <div className="rounded-lg border border-border bg-bg px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Skipped</p>
          <p className="mt-1 text-sm text-text-secondary">
            {formatSkippedDomains(current.skippedDomains)}
          </p>
        </div>
      ) : null}
      <WizardDialogFooter>
        <Button variant="primary" onClick={model.requestClose}>
          Done
        </Button>
      </WizardDialogFooter>
    </>
  )
}

export function BrowserImportBlockedStep({
  headingId,
  model,
  current,
}: WizardStepProps & {
  readonly current: Extract<BrowserImportWizardStep, { readonly step: 'blocked' }>
}) {
  const action = browserImportBlockedAction(current.reason)
  const actionLabel = match(action)
    .with('retry', () => 'Try again')
    .with('configure', () => 'Choose destination')
    .with('refresh', () => 'Refresh profiles')
    .with('none', () => undefined)
    .exhaustive()
  const runAction = () =>
    match(action)
      .with('retry', model.runImport)
      .with('configure', () => model.setStep({ step: 'configure' }))
      .with('refresh', () => model.recheckSource('browser', refreshedBrowserImportSourceStep))
      .with('none', () => undefined)
      .exhaustive()

  return (
    <>
      <WizardDialogHeader
        headingId={headingId}
        title={`Could not import from ${model.source.name}`}
        description={BROWSER_IMPORT_FAILURE_COPY[current.reason]}
      />
      <WizardDialogFooter>
        <Button onClick={model.requestClose}>Close</Button>
        {actionLabel ? (
          <Button variant="primary" onClick={runAction}>
            {actionLabel}
          </Button>
        ) : null}
      </WizardDialogFooter>
    </>
  )
}
