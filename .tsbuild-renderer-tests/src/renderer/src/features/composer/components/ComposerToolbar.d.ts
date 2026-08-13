import type { RefObject } from 'react';
interface ComposerToolbarProps {
    readonly onSend: () => void;
    readonly onCancel: () => void;
    readonly isLoading: boolean;
    readonly canSend: boolean;
    readonly onToggleVoice: () => void;
    readonly voiceMode: 'idle' | 'recording' | 'transcribing';
    readonly fileInputRef: RefObject<HTMLInputElement | null>;
    readonly sendTitle?: string;
}
export declare function ComposerToolbar({ onSend, onCancel, isLoading, canSend, onToggleVoice, voiceMode, fileInputRef, sendTitle, }: ComposerToolbarProps): import("node_modules/@types/react").JSX.Element;
export {};
