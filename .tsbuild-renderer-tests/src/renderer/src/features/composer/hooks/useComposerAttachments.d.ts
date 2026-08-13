import type { PreparedAttachment } from '@shared/types/agent';
import { useAutoTextAttachment } from './useAutoTextAttachment';
import { type UseFileAttachmentResult } from './useFileAttachment';
interface UseComposerAttachmentsInput {
    readonly projectPath: string | null;
    readonly onToast?: (message: string) => void;
}
export interface ComposerAttachmentsController {
    readonly attachments: readonly PreparedAttachment[];
    readonly attachmentError: string | null;
    readonly pendingTextAttachmentChips: ReturnType<typeof useAutoTextAttachment>['pendingTextAttachmentChips'];
    readonly hasPreparingTextAttachment: boolean;
    readonly checkAndConvertPaste: (pastedText: string, currentEditorText: string) => boolean;
    readonly removeAttachment: (attachmentId: string) => void;
    readonly removePendingTextAttachment: (operationId: string, attachmentId: string) => void;
    readonly clearAttachmentError: () => void;
    readonly fileAttachment: UseFileAttachmentResult;
}
export declare function useComposerAttachments({ projectPath, onToast }: UseComposerAttachmentsInput): {
    attachments: import("@shared/types/agent").AttachmentRecord[];
    attachmentError: string | null;
    pendingTextAttachmentChips: import("./useAutoTextAttachment").PendingTextAttachmentChip[];
    hasPreparingTextAttachment: boolean;
    checkAndConvertPaste: (pastedText: string, currentEditorText: string) => boolean;
    removeAttachment: (id: string) => void;
    removePendingTextAttachment: (operationId: string, attachmentId: string) => void;
    clearAttachmentError: () => void;
    fileAttachment: UseFileAttachmentResult;
};
export {};
