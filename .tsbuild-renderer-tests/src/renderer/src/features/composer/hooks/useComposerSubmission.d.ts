import type { AgentSendPayload, PreparedAttachment } from '@shared/types/agent';
import type { LexicalEditor } from 'lexical';
import type { RefObject } from 'react';
interface UseComposerSubmissionInput {
    readonly onSend: (payload: AgentSendPayload) => Promise<void> | void;
    readonly onEnqueue: (payload: AgentSendPayload) => Promise<void> | void;
    readonly isLoading: boolean;
    readonly disabled?: boolean;
    readonly requiresText: boolean;
    readonly clearOnSubmit: boolean;
    readonly recordHistory: boolean;
    readonly allowEnqueue: boolean;
    readonly onToast?: (message: string) => void;
    readonly editorRef: RefObject<LexicalEditor | null>;
    readonly projectPath: string | null;
    readonly attachments: readonly PreparedAttachment[];
    readonly hasPreparingTextAttachment: boolean;
}
export declare function useComposerSubmission({ onSend, onEnqueue, isLoading, disabled, requiresText, clearOnSubmit, recordHistory, allowEnqueue, onToast, editorRef, projectPath, attachments, hasPreparingTextAttachment, }: UseComposerSubmissionInput): {
    input: string;
    projectPath: string | null;
    canSend: boolean;
    handleSubmit: (text?: string) => void;
    sendComposed: (text: string) => boolean;
    submitCurrentDraft: () => void;
};
export {};
