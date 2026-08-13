import { useVoiceVisualizer } from 'react-voice-visualizer';
export type VoiceRecorderMode = 'idle' | 'recording' | 'transcribing';
export type VoiceVisualizerControls = ReturnType<typeof useVoiceVisualizer>;
interface UseVoiceCaptureOptions {
    insertText: (text: string) => void;
    sendComposed: (text: string) => boolean;
}
export interface VoiceCaptureController {
    canStart: boolean;
    clearError: () => void;
    elapsedSeconds: number;
    error: string | null;
    isActive: boolean;
    mode: VoiceRecorderMode;
    stopAndSend: () => void;
    stopCapture: () => void;
    toggleVoice: () => void;
    visualizerControls: VoiceVisualizerControls;
}
export declare function useVoiceCapture({ insertText, sendComposed, }: UseVoiceCaptureOptions): VoiceCaptureController;
export declare function formatVoiceDuration(totalSeconds: number): string;
export {};
