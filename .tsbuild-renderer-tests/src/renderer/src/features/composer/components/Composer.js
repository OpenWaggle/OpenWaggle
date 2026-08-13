import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
import { useProject } from '@/features/sessions/hooks';
import { useComposerAttachments } from '../hooks/useComposerAttachments';
import { useComposerSubmission } from '../hooks/useComposerSubmission';
import { useComposerVoiceControls } from '../hooks/useComposerVoiceControls';
import { ComposerDropZone } from './ComposerDropZone';
import { ComposerEditorArea } from './ComposerEditorArea';
import { ComposerHeader } from './ComposerHeader';
import { ComposerHiddenFileInput } from './ComposerHiddenFileInput';
import { ComposerModeControls } from './ComposerModeControls';
export function Composer({ onSend, onEnqueue, onCancel, isLoading, mode, onToast }) {
    const disabled = mode?.disabled;
    const placeholder = mode?.placeholder;
    const sendTitle = mode?.sendTitle;
    const requiresText = mode?.requiresText ?? false;
    const clearOnSubmit = mode?.clearOnSubmit ?? true;
    const recordHistory = mode?.recordHistory ?? true;
    const allowEnqueue = mode?.allowEnqueue ?? true;
    const editorRef = useRef(null);
    const fileInputRef = useRef(null);
    const { projectPath } = useProject();
    const attachments = useComposerAttachments({ projectPath, onToast });
    const submission = useComposerSubmission({
        onSend,
        onEnqueue,
        isLoading,
        disabled,
        requiresText,
        clearOnSubmit,
        recordHistory,
        allowEnqueue,
        onToast,
        editorRef,
        projectPath,
        attachments: attachments.attachments,
        hasPreparingTextAttachment: attachments.hasPreparingTextAttachment,
    });
    const voice = useComposerVoiceControls({
        editorRef,
        sendComposed: submission.sendComposed,
        submitCurrentDraft: submission.submitCurrentDraft,
    });
    useEffect(() => {
        if (!isLoading)
            editorRef.current?.focus();
    }, [isLoading]);
    return (_jsxs("div", { className: "shrink-0", children: [_jsx("output", { "aria-live": "polite", className: "sr-only", children: isLoading ? 'Agent is working' : '' }), _jsx(ComposerHiddenFileInput, { fileInputRef: fileInputRef, handleAttachFiles: attachments.fileAttachment.handleAttachFiles }), _jsxs(ComposerDropZone, { fileAttachment: attachments.fileAttachment, children: [_jsx(ComposerHeader, { attachments: attachments, voiceError: voice.error, onClearVoiceError: voice.clearError }), _jsx(ComposerEditorArea, { onSubmit: submission.handleSubmit, disabled: disabled, placeholder: placeholder, isLoading: isLoading, editorRef: editorRef, checkAndConvertPaste: attachments.checkAndConvertPaste }), _jsx(ComposerModeControls, { fileInputRef: fileInputRef, voice: voice, onSubmit: () => {
                            submission.handleSubmit();
                        }, onCancel: onCancel, isLoading: isLoading, canSend: submission.canSend, sendTitle: sendTitle })] })] }));
}
