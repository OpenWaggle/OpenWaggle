import { useComposerActionStore } from '@/features/composer/state/composer-action-store'
import type { ComposerAttachmentsController } from '../hooks'
import { AutoTextAttachmentChips } from './AutoTextAttachmentChips'
import { ComposerAlerts } from './ComposerAlerts'

interface ComposerHeaderProps {
  readonly attachments: ComposerAttachmentsController
  readonly voiceError: string | null
  readonly onClearVoiceError: () => void
}

interface ComposerAlertViewModel {
  readonly id: string
  readonly message: string
  readonly onDismiss?: () => void
}

export function ComposerHeader({
  attachments,
  voiceError,
  onClearVoiceError,
}: ComposerHeaderProps) {
  const branchMessage = useComposerActionStore((s) => s.branchMessage)
  const setBranchMessage = useComposerActionStore((s) => s.setBranchMessage)
  const alerts = buildComposerAlerts({
    attachmentError: attachments.attachmentError,
    clearAttachmentError: attachments.clearAttachmentError,
    voiceError,
    onClearVoiceError,
    branchMessage,
    clearBranchMessage: () => setBranchMessage(null),
  })

  return (
    <div className="px-4 pt-3">
      <AutoTextAttachmentChips
        pendingTextAttachmentChips={attachments.pendingTextAttachmentChips}
        attachments={attachments.attachments}
        onRemoveAttachment={attachments.removeAttachment}
        onRemovePendingAttachment={attachments.removePendingTextAttachment}
      />
      <ComposerAlerts alerts={alerts} />
    </div>
  )
}

interface BuildComposerAlertsInput {
  readonly attachmentError: string | null
  readonly clearAttachmentError: () => void
  readonly voiceError: string | null
  readonly onClearVoiceError: () => void
  readonly branchMessage: string | null
  readonly clearBranchMessage: () => void
}

function buildComposerAlerts({
  attachmentError,
  clearAttachmentError,
  voiceError,
  onClearVoiceError,
  branchMessage,
  clearBranchMessage,
}: BuildComposerAlertsInput) {
  const alerts: ComposerAlertViewModel[] = []
  appendComposerAlert(alerts, 'attachment-error', attachmentError, clearAttachmentError)
  appendComposerAlert(alerts, 'voice-error', voiceError, onClearVoiceError)
  appendComposerAlert(alerts, 'branch-message', branchMessage, clearBranchMessage)
  return alerts
}

function appendComposerAlert(
  alerts: ComposerAlertViewModel[],
  id: string,
  message: string | null,
  onDismiss: () => void,
) {
  if (message) alerts.push({ id, message, onDismiss })
}
