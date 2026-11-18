import { matchBy } from '@diegogbrisa/ts-match'
import { useId } from 'react'
import {
  type BrowserImportWizardOptions,
  useBrowserImportWizard,
} from '@/features/settings/hooks/useBrowserImportWizard'
import { canCloseBrowserImportWizard } from '@/features/settings/lib/browser-import-wizard-logic'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { BrowserImportConfigureStep } from './BrowserImportWizardConfigureStep'
import {
  BrowserImportBlockedStep,
  BrowserImportCheckingStep,
  BrowserImportDoneStep,
  BrowserImportFullDiskAccessStep,
  BrowserImportImportingStep,
  BrowserImportQuitStep,
} from './BrowserImportWizardStatusSteps'

export function BrowserImportWizard(options: BrowserImportWizardOptions) {
  const headingId = useId()
  const model = useBrowserImportWizard(options)

  return (
    <ModalDialog
      labelledBy={headingId}
      onClose={model.requestClose}
      dismissible={canCloseBrowserImportWizard(model.step)}
      className="max-w-135"
    >
      <div className="space-y-5 p-5">
        {matchBy(model.step, 'step')
          .with('quit', () => <BrowserImportQuitStep headingId={headingId} model={model} />)
          .with('full-disk-access', (current) => (
            <BrowserImportFullDiskAccessStep
              headingId={headingId}
              model={model}
              current={current}
            />
          ))
          .with('configure', () => (
            <BrowserImportConfigureStep headingId={headingId} model={model} />
          ))
          .with('checking', (current) => (
            <BrowserImportCheckingStep headingId={headingId} model={model} current={current} />
          ))
          .with('importing', () => <BrowserImportImportingStep headingId={headingId} />)
          .with('done', (current) => (
            <BrowserImportDoneStep headingId={headingId} model={model} current={current} />
          ))
          .with('blocked', (current) => (
            <BrowserImportBlockedStep headingId={headingId} model={model} current={current} />
          ))
          .exhaustive()}
      </div>
    </ModalDialog>
  )
}
