import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useComposerActionStore } from '@/features/composer/state/composer-action-store';
import { AutoTextAttachmentChips } from './AutoTextAttachmentChips';
import { ComposerAlerts } from './ComposerAlerts';
export function ComposerHeader({ attachments, voiceError, onClearVoiceError, }) {
    const branchMessage = useComposerActionStore((s) => s.branchMessage);
    const setBranchMessage = useComposerActionStore((s) => s.setBranchMessage);
    const alerts = buildComposerAlerts({
        attachmentError: attachments.attachmentError,
        clearAttachmentError: attachments.clearAttachmentError,
        voiceError,
        onClearVoiceError,
        branchMessage,
        clearBranchMessage: () => setBranchMessage(null),
    });
    return (_jsxs("div", { className: "px-4 pt-3", children: [_jsx(AutoTextAttachmentChips, { pendingTextAttachmentChips: attachments.pendingTextAttachmentChips, attachments: attachments.attachments, onRemoveAttachment: attachments.removeAttachment, onRemovePendingAttachment: attachments.removePendingTextAttachment }), _jsx(ComposerAlerts, { alerts: alerts })] }));
}
function buildComposerAlerts({ attachmentError, clearAttachmentError, voiceError, onClearVoiceError, branchMessage, clearBranchMessage, }) {
    const alerts = [];
    appendComposerAlert(alerts, 'attachment-error', attachmentError, clearAttachmentError);
    appendComposerAlert(alerts, 'voice-error', voiceError, onClearVoiceError);
    appendComposerAlert(alerts, 'branch-message', branchMessage, clearBranchMessage);
    return alerts;
}
function appendComposerAlert(alerts, id, message, onDismiss) {
    if (message)
        alerts.push({ id, message, onDismiss });
}
