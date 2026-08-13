import { useRef, useState } from 'react';
import { api } from '@/shared/lib/ipc';
import { createRendererLogger } from '@/shared/lib/logger';
const logger = createRendererLogger('file-attachment');
const MAX_ATTACHMENTS = 5;
function describeAttachmentError(err) {
    return err instanceof Error ? err.message : 'Failed to prepare attachments.';
}
function reportAttachmentError(err, setAttachmentError, onToast) {
    const message = describeAttachmentError(err);
    logger.warn('Failed to prepare selected file attachments', { error: message });
    setAttachmentError(message);
    onToast?.(message);
}
async function prepareAndAttach(projectPath, files, addAttachments, setAttachmentError, onToast) {
    try {
        setAttachmentError(null);
        const prepared = await api.prepareAttachments(projectPath, files);
        if (prepared.length === 0)
            return;
        addAttachments(prepared);
        onToast?.(`Attached ${String(prepared.length)} file${prepared.length === 1 ? '' : 's'}.`);
    }
    catch (err) {
        reportAttachmentError(err, setAttachmentError, onToast);
    }
}
export function useFileAttachment({ projectPath, attachments, preparingPendingCount, addAttachments, setAttachmentError, onToast, }) {
    const [isDragOver, setIsDragOver] = useState(false);
    const dragCounterRef = useRef(0);
    const usedSlots = attachments.length + preparingPendingCount;
    const remainingSlots = Math.max(0, MAX_ATTACHMENTS - usedSlots);
    const isAtCapacity = remainingSlots === 0;
    function handleDragEnter(event) {
        event.preventDefault();
        dragCounterRef.current++;
        if (event.dataTransfer.types.includes('Files')) {
            setIsDragOver(true);
        }
    }
    function handleDragLeave(event) {
        event.preventDefault();
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) {
            setIsDragOver(false);
        }
    }
    function handleDragOver(event) {
        event.preventDefault();
        if (isAtCapacity) {
            event.dataTransfer.dropEffect = 'none';
        }
    }
    async function validateAndAttach(files) {
        if (!projectPath) {
            setAttachmentError('Select a project before attaching files.');
            return;
        }
        if (files.length === 0)
            return;
        if (isAtCapacity)
            return;
        // Silently trim to remaining capacity
        const trimmed = files.slice(0, remainingSlots);
        await prepareAndAttach(projectPath, trimmed, addAttachments, setAttachmentError, onToast);
    }
    async function handleDrop(event) {
        event.preventDefault();
        dragCounterRef.current = 0;
        setIsDragOver(false);
        if (isAtCapacity)
            return;
        try {
            await validateAndAttach(Array.from(event.dataTransfer.files));
        }
        catch (err) {
            reportAttachmentError(err, setAttachmentError, onToast);
        }
    }
    async function handleAttachFiles(event) {
        const files = Array.from(event.target.files ?? []);
        try {
            await validateAndAttach(files);
        }
        catch (err) {
            reportAttachmentError(err, setAttachmentError, onToast);
        }
        finally {
            event.target.value = '';
        }
    }
    return {
        isDragOver,
        isAtCapacity,
        handleDragEnter,
        handleDragLeave,
        handleDragOver,
        handleDrop,
        handleAttachFiles,
    };
}
