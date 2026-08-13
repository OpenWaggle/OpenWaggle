import type { PreparedAttachment } from '@shared/types/agent';
export interface PendingTextAttachmentChip {
    operationId: string;
    name: string;
    progressPercent: number;
    status: 'preparing' | 'ready';
    attachmentId: string | null;
}
interface UseAutoTextAttachmentOptions {
    attachments: PreparedAttachment[];
    addAttachments: (attachments: PreparedAttachment[]) => void;
    removeAttachment: (attachmentId: string) => void;
    setAttachmentError: (error: string | null) => void;
    setInput: (input: string) => void;
    onToast?: (message: string) => void;
}
interface UseAutoTextAttachmentResult {
    pendingTextAttachmentChips: PendingTextAttachmentChip[];
    hasPreparingTextAttachment: boolean;
    preparingPendingCount: number;
    /** Called by PastePlugin. Returns true if the paste was auto-converted to an attachment. */
    checkAndConvertPaste: (pastedText: string, currentEditorText: string) => boolean;
    removePendingTextAttachment: (operationId: string, attachmentId: string) => void;
}
export declare function useAutoTextAttachment({ attachments, addAttachments, removeAttachment, setAttachmentError, setInput, onToast, }: UseAutoTextAttachmentOptions): UseAutoTextAttachmentResult;
export {};
