import type { RefObject } from 'react';
import type { VoiceCaptureController } from '../hooks/useVoiceCapture';
interface VoiceRecorderProps {
    fileInputRef: RefObject<HTMLInputElement | null>;
    voice: VoiceCaptureController;
}
export declare function VoiceRecorder({ fileInputRef, voice }: VoiceRecorderProps): import("node_modules/@types/react").JSX.Element;
export {};
