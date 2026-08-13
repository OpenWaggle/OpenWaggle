import { useSelectedModelThinkingLevel } from '@/features/providers/hooks';
import { usePreferencesStore } from '@/features/settings/state';
import { clearEditor } from '../lib/lexical-utils';
import { consumeSendResult } from '../lib/send-result';
import { useComposerStore } from '../state/composer-store';
const SILENT_SUBMIT_BLOCK = { type: 'silent' };
export function useComposerSubmission({ onSend, onEnqueue, isLoading, disabled, requiresText, clearOnSubmit, recordHistory, allowEnqueue, onToast, editorRef, projectPath, attachments, hasPreparingTextAttachment, }) {
    const input = useComposerStore((s) => s.input);
    const reset = useComposerStore((s) => s.reset);
    const pushHistory = useComposerStore((s) => s.pushHistory);
    const selectedModel = usePreferencesStore((s) => s.settings.selectedModel);
    const { effectiveThinkingLevel } = useSelectedModelThinkingLevel();
    function clearComposerInput() {
        reset();
        if (editorRef.current) {
            clearEditor(editorRef.current);
        }
    }
    function dispatchPayload(payload) {
        const block = getSubmitBlock({ payload, disabled, requiresText, projectPath, selectedModel });
        if (!block) {
            consumeSendResult(isLoading && allowEnqueue ? onEnqueue(payload) : onSend(payload));
            return true;
        }
        if (block.type === 'toast')
            onToast?.(block.message);
        return false;
    }
    function submitPayload(payload) {
        const sent = dispatchPayload(payload);
        if (!sent)
            return false;
        if (recordHistory && payload.text)
            pushHistory(payload.text);
        if (clearOnSubmit)
            clearComposerInput();
        return true;
    }
    function handleSubmit(text) {
        submitPayload({
            text: (text ?? input).trim(),
            thinkingLevel: effectiveThinkingLevel,
            attachments,
        });
    }
    function sendComposed(text) {
        return submitPayload({
            text,
            thinkingLevel: effectiveThinkingLevel,
            attachments: useComposerStore.getState().attachments,
        });
    }
    function submitCurrentDraft() {
        const state = useComposerStore.getState();
        submitPayload({
            text: state.input.trim(),
            thinkingLevel: effectiveThinkingLevel,
            attachments: state.attachments,
        });
    }
    return {
        input,
        projectPath,
        canSend: canSend({
            input,
            attachments,
            disabled,
            hasPreparingTextAttachment,
            projectPath,
            selectedModel,
            requiresText,
        }),
        handleSubmit,
        sendComposed,
        submitCurrentDraft,
    };
}
function getSubmitBlock({ payload, disabled, requiresText, projectPath, selectedModel, }) {
    if (requiresText && !payload.text)
        return SILENT_SUBMIT_BLOCK;
    if (disabled || (!payload.text && payload.attachments.length === 0))
        return SILENT_SUBMIT_BLOCK;
    if (!projectPath)
        return toastSubmitBlock('Select a project before sending.');
    if (!selectedModel.trim())
        return toastSubmitBlock('Select a model in Settings before sending.');
    return null;
}
function toastSubmitBlock(message) {
    return { type: 'toast', message };
}
function canSend({ input, attachments, disabled, hasPreparingTextAttachment, projectPath, selectedModel, requiresText, }) {
    const hasSubmitContent = requiresText
        ? input.trim().length > 0
        : input.trim().length > 0 || attachments.length > 0;
    return (hasSubmitContent &&
        !disabled &&
        !hasPreparingTextAttachment &&
        Boolean(projectPath) &&
        selectedModel.trim().length > 0);
}
