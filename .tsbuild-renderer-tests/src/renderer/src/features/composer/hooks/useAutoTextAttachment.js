import { PERCENT_BASE } from '@shared/constants/math';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/shared/lib/ipc';
const LONG_PROMPT_THRESHOLD = 12_000;
const MAX_ATTACHMENTS = 5;
const PENDING_ATTACHMENT_DISMISS_DELAY_MS = 1200;
const AUTO_PASTE_ATTACHMENT_NAME_PREFIX = 'Pasted Text ';
const AUTO_PASTE_ATTACHMENT_FILE_EXTENSION = '.md';
export function useAutoTextAttachment({ attachments, addAttachments, removeAttachment, setAttachmentError, setInput, onToast, }) {
    const nextAutoPasteAttachmentIndexRef = useRef(1);
    const pendingAttachmentTimersRef = useRef(new Map());
    const [pendingTextAttachmentChips, setPendingTextAttachmentChips] = useState([]);
    const preparingPendingCount = pendingTextAttachmentChips.filter((chip) => chip.status === 'preparing').length;
    const hasPreparingTextAttachment = preparingPendingCount > 0;
    function clearPendingChip(operationId) {
        const timer = pendingAttachmentTimersRef.current.get(operationId);
        if (timer) {
            clearTimeout(timer);
            pendingAttachmentTimersRef.current.delete(operationId);
        }
        setPendingTextAttachmentChips((chips) => chips.filter((chip) => chip.operationId !== operationId));
    }
    async function handleAutoConvertLongPaste(pastedText, fallbackInput, operationId, chipName) {
        const trimmedPastedText = pastedText.trim();
        if (!trimmedPastedText)
            return;
        const prepareAttachmentFromText = api.prepareAttachmentFromText;
        if (typeof prepareAttachmentFromText !== 'function') {
            clearPendingChip(operationId);
            setAttachmentError('Attachment conversion is unavailable. Please restart the app.');
            setInput(fallbackInput);
            return;
        }
        const autoAttachment = await prepareAttachmentFromText(trimmedPastedText, operationId).catch(() => null);
        if (!autoAttachment) {
            clearPendingChip(operationId);
            setInput(fallbackInput);
            return;
        }
        setAttachmentError(null);
        addAttachments([{ ...autoAttachment, name: chipName }]);
        setPendingTextAttachmentChips((chips) => chips.map((chip) => chip.operationId === operationId
            ? {
                ...chip,
                status: 'ready',
                progressPercent: PERCENT_BASE,
                attachmentId: autoAttachment.id,
            }
            : chip));
        const dismissTimer = setTimeout(() => {
            setPendingTextAttachmentChips((chips) => chips.filter((chip) => chip.operationId !== operationId));
            pendingAttachmentTimersRef.current.delete(operationId);
        }, PENDING_ATTACHMENT_DISMISS_DELAY_MS);
        pendingAttachmentTimersRef.current.set(operationId, dismissTimer);
        onToast?.('Long prompt auto-converted to file attachment.');
    }
    function checkAndConvertPaste(pastedText, currentEditorText) {
        if (!pastedText)
            return false;
        const nextValue = `${currentEditorText}${pastedText}`;
        const usedAttachmentSlots = attachments.length + preparingPendingCount;
        const shouldAutoConvert = nextValue.trim().length > LONG_PROMPT_THRESHOLD && usedAttachmentSlots < MAX_ATTACHMENTS;
        if (!shouldAutoConvert)
            return false;
        const operationId = globalThis.crypto.randomUUID();
        const chipName = `${AUTO_PASTE_ATTACHMENT_NAME_PREFIX}${String(nextAutoPasteAttachmentIndexRef.current)}${AUTO_PASTE_ATTACHMENT_FILE_EXTENSION}`;
        nextAutoPasteAttachmentIndexRef.current += 1;
        setPendingTextAttachmentChips((chips) => [
            ...chips,
            {
                operationId,
                name: chipName,
                progressPercent: 0,
                status: 'preparing',
                attachmentId: null,
            },
        ]);
        void handleAutoConvertLongPaste(pastedText, currentEditorText, operationId, chipName);
        return true;
    }
    function removePendingTextAttachment(operationId, attachmentId) {
        removeAttachment(attachmentId);
        setPendingTextAttachmentChips((chips) => chips.filter((entry) => entry.operationId !== operationId));
    }
    useEffect(() => {
        const subscribeToProgress = api.onPrepareAttachmentFromTextProgress;
        if (typeof subscribeToProgress !== 'function') {
            return () => { };
        }
        const unsubscribe = subscribeToProgress((payload) => {
            setPendingTextAttachmentChips((chips) => chips.map((chip) => chip.operationId === payload.operationId
                ? {
                    ...chip,
                    progressPercent: payload.progressPercent,
                    status: payload.stage === 'completed' ? 'ready' : chip.status,
                }
                : chip));
        });
        return () => {
            unsubscribe();
            for (const timer of pendingAttachmentTimersRef.current.values()) {
                clearTimeout(timer);
            }
            pendingAttachmentTimersRef.current.clear();
        };
    }, []);
    return {
        pendingTextAttachmentChips,
        hasPreparingTextAttachment,
        preparingPendingCount,
        checkAndConvertPaste,
        removePendingTextAttachment,
    };
}
