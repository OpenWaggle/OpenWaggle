import type { PreparedAttachment } from '@shared/types/agent';
import type { PendingTextAttachmentChip } from '../hooks/useAutoTextAttachment';
interface AutoTextAttachmentChipsProps {
    pendingTextAttachmentChips: readonly PendingTextAttachmentChip[];
    attachments: readonly PreparedAttachment[];
    onRemoveAttachment: (attachmentId: string) => void;
    onRemovePendingAttachment: (operationId: string, attachmentId: string) => void;
}
export declare function AutoTextAttachmentChips({ pendingTextAttachmentChips, attachments, onRemoveAttachment, onRemovePendingAttachment, }: AutoTextAttachmentChipsProps): import("node_modules/@types/react").JSX.Element | null;
export {};
