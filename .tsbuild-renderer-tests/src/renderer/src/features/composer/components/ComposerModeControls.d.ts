import type { RefObject } from 'react';
import type { VoiceCaptureController } from '../hooks/useVoiceCapture';
interface ComposerModeControlsProps {
    readonly fileInputRef: RefObject<HTMLInputElement | null>;
    readonly voice: VoiceCaptureController;
    readonly onSubmit: () => void;
    readonly onCancel: () => void;
    readonly isLoading: boolean;
    readonly canSend: boolean;
    readonly sendTitle?: string;
}
export declare function ComposerModeControls({ fileInputRef, voice, onSubmit, onCancel, isLoading, canSend, sendTitle, }: ComposerModeControlsProps): import("node_modules/@types/react").JSX.Element;
export {};
