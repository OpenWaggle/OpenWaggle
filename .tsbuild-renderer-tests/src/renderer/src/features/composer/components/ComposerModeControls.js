import { jsx as _jsx } from "react/jsx-runtime";
import { ComposerToolbar } from './ComposerToolbar';
import { VoiceRecorder } from './VoiceRecorder';
export function ComposerModeControls({ fileInputRef, voice, onSubmit, onCancel, isLoading, canSend, sendTitle, }) {
    if (voice.isActive) {
        return _jsx(VoiceRecorder, { fileInputRef: fileInputRef, voice: voice });
    }
    return (_jsx(ComposerToolbar, { onSend: onSubmit, onCancel: onCancel, isLoading: isLoading, canSend: canSend, onToggleVoice: voice.toggleVoice, voiceMode: voice.mode, fileInputRef: fileInputRef, sendTitle: sendTitle }));
}
