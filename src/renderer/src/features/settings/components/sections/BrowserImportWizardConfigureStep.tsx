import { ArrowDown, ArrowRight } from 'lucide-react'
import type { BrowserImportWizardController } from '@/features/settings/hooks/useBrowserImportWizard'
import { Button } from '@/shared/ui/Button'
import {
  cookieCountLabel,
  WizardDialogFooter,
  WizardDialogHeader,
  WizardSelectableTile,
} from './BrowserImportWizardPrimitives'

function targetAvailability(model: BrowserImportWizardController) {
  const target = model.target
  const missing =
    target.kind === 'existing' &&
    !model.targetProfiles.some((profile) => profile.id === target.profileId)
  const uncreatable = target.kind === 'new' && !model.canCreateProfile
  const feedback =
    model.targetError ??
    (missing
      ? 'That profile is no longer available. Choose where to import these cookies.'
      : uncreatable
        ? 'You have reached the profile limit. Choose an existing profile.'
        : undefined)
  return { missing, uncreatable, feedback }
}

export function BrowserImportConfigureStep({
  headingId,
  model,
}: {
  readonly headingId: string
  readonly model: BrowserImportWizardController
}) {
  const availability = targetAvailability(model)

  return (
    <>
      <WizardDialogHeader
        headingId={headingId}
        title={`Import from ${model.source.name}`}
        description="Choose the source profile and its isolated OpenWaggle destination."
      />
      <div className="rounded-lg border border-border bg-bg p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <section className="min-w-0 flex-1 space-y-2" aria-labelledby={`${headingId}-from`}>
            <p
              id={`${headingId}-from`}
              className="text-xs font-medium uppercase tracking-wide text-text-tertiary"
            >
              From
            </p>
            {model.source.profiles.map((profile) => (
              <WizardSelectableTile
                key={profile.directory}
                selected={model.sourceProfileDirectory === profile.directory}
                title={profile.name}
                subtitle={cookieCountLabel(profile.cookieCount)}
                onSelect={() => model.setSourceProfileDirectory(profile.directory)}
              />
            ))}
          </section>
          <div aria-hidden="true" className="flex shrink-0 justify-center text-text-quaternary">
            <ArrowDown className="size-4 sm:hidden" />
            <ArrowRight className="hidden size-4 sm:block" />
          </div>
          <section className="min-w-0 flex-1 space-y-2" aria-labelledby={`${headingId}-into`}>
            <p
              id={`${headingId}-into`}
              className="text-xs font-medium uppercase tracking-wide text-text-tertiary"
            >
              Into
            </p>
            {model.canCreateProfile ? (
              <WizardSelectableTile
                selected={model.target.kind === 'new'}
                title="New profile"
                subtitle="Created after cookies import"
                onSelect={() => model.selectTarget({ kind: 'new' })}
              />
            ) : null}
            {model.targetProfiles.map((profile) => (
              <WizardSelectableTile
                key={profile.id}
                selected={model.target.kind === 'existing' && model.target.profileId === profile.id}
                title={profile.name}
                subtitle="Existing profile"
                onSelect={() => model.selectTarget({ kind: 'existing', profileId: profile.id })}
              />
            ))}
          </section>
        </div>
        {availability.feedback ? (
          <p role="alert" className="mt-3 text-sm text-error-text">
            {availability.feedback}
          </p>
        ) : null}
      </div>
      <p className="text-xs text-text-quaternary">
        This is a one-time copy. Future browser changes are not synced.
      </p>
      <WizardDialogFooter>
        <Button onClick={model.requestClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={
            model.sourceProfileDirectory === '' || availability.missing || availability.uncreatable
          }
          onClick={model.runImport}
        >
          Import cookies
        </Button>
      </WizardDialogFooter>
    </>
  )
}
