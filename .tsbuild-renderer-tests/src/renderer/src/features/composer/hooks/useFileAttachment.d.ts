import type { PreparedAttachment } from '@shared/types/agent';
interface UseFileAttachmentParams {
    readonly projectPath: string | null;
    readonly attachments: readonly PreparedAttachment[];
    readonly preparingPendingCount: number;
    readonly addAttachments: (attachments: PreparedAttachment[]) => void;
    readonly setAttachmentError: (error: string | null) => void;
    readonly onToast?: (message: string) => void;
}
export interface UseFileAttachmentResult {
    readonly isDragOver: boolean;
    readonly isAtCapacity: boolean;
    readonly handleDragEnter: (event: React.DragEvent) => void;
    readonly handleDragLeave: (event: React.DragEvent) => void;
    readonly handleDragOver: (event: React.DragEvent) => void;
    readonly handleDrop: (event: React.DragEvent) => Promise<void>;
    readonly handleAttachFiles: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}
export declare function useFileAttachment({ projectPath, attachments, preparingPendingCount, addAttachments, setAttachmentError, onToast, }: UseFileAttachmentParams): UseFileAttachmentResult;
export {};
