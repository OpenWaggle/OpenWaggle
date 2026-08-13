import { useComposerStore } from '../state/composer-store';
import { useAutoTextAttachment } from './useAutoTextAttachment';
import { useFileAttachment } from './useFileAttachment';
export function useComposerAttachments({ projectPath, onToast }) {
    const attachments = useComposerStore((s) => s.attachments);
    const attachmentError = useComposerStore((s) => s.attachmentError);
    const setInput = useComposerStore((s) => s.setInput);
    const setAttachmentError = useComposerStore((s) => s.setAttachmentError);
    const addAttachments = useComposerStore((s) => s.addAttachments);
    const removeAttachment = useComposerStore((s) => s.removeAttachment);
    const textAttachment = useAutoTextAttachment({
        attachments,
        addAttachments,
        removeAttachment,
        setAttachmentError,
        setInput,
        onToast,
    });
    const fileAttachment = useFileAttachment({
        projectPath,
        attachments,
        preparingPendingCount: textAttachment.preparingPendingCount,
        addAttachments,
        setAttachmentError,
        onToast,
    });
    return {
        attachments,
        attachmentError,
        pendingTextAttachmentChips: textAttachment.pendingTextAttachmentChips,
        hasPreparingTextAttachment: textAttachment.hasPreparingTextAttachment,
        checkAndConvertPaste: textAttachment.checkAndConvertPaste,
        removeAttachment,
        removePendingTextAttachment: textAttachment.removePendingTextAttachment,
        clearAttachmentError: () => setAttachmentError(null),
        fileAttachment,
    };
}
