import type { LexicalEditor } from 'lexical';
import type { RefObject } from 'react';
interface UseComposerVoiceControlsInput {
    readonly editorRef: RefObject<LexicalEditor | null>;
    readonly sendComposed: (text: string) => boolean;
    readonly submitCurrentDraft: () => void;
}
export declare function useComposerVoiceControls({ editorRef, sendComposed, submitCurrentDraft, }: UseComposerVoiceControlsInput): import("./useVoiceCapture").VoiceCaptureController;
export {};
