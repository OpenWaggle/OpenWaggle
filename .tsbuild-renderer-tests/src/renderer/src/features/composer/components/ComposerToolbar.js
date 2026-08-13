import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ComposerAttachButton } from './ComposerAttachButton';
import { ComposerModelPicker } from './ComposerModelPicker';
import { ComposerSendControls } from './ComposerSendControls';
import { ComposerVoiceButton } from './ComposerVoiceButton';
import { ContextMeter } from './ContextMeter';
import { ThinkingLevelMenu } from './ThinkingLevelMenu';
export function ComposerToolbar({ onSend, onCancel, isLoading, canSend, onToggleVoice, voiceMode, fileInputRef, sendTitle, }) {
    return (_jsxs("div", { className: "flex h-11 items-center justify-between px-4", children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx(ComposerAttachButton, { fileInputRef: fileInputRef }), _jsx(ComposerModelPicker, {}), _jsx(ThinkingLevelMenu, {})] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(ContextMeter, {}), _jsx(ComposerVoiceButton, { mode: voiceMode, onToggleVoice: onToggleVoice }), _jsx(ComposerSendControls, { isLoading: isLoading, canSend: canSend, sendTitle: sendTitle, onSend: onSend, onCancel: onCancel })] })] }));
}
