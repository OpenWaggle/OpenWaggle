import type { ComposerAttachmentsController } from '../hooks';
interface ComposerHeaderProps {
    readonly attachments: ComposerAttachmentsController;
    readonly voiceError: string | null;
    readonly onClearVoiceError: () => void;
}
export declare function ComposerHeader({ attachments, voiceError, onClearVoiceError, }: ComposerHeaderProps): import("node_modules/@types/react").JSX.Element;
export {};
