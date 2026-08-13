import type { VoiceRecorderMode } from '../hooks/useVoiceCapture';
interface ComposerVoiceButtonProps {
    readonly mode: VoiceRecorderMode;
    readonly onToggleVoice: () => void;
}
export declare function ComposerVoiceButton({ mode, onToggleVoice }: ComposerVoiceButtonProps): import("node_modules/@types/react").JSX.Element;
export {};
