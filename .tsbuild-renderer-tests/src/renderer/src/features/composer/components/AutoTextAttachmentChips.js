import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { PERCENT_BASE } from '@shared/constants/math';
import { Check, FileDown, FileText, ImageIcon, Loader2, X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
const KIND_ICON = {
    image: ImageIcon,
    pdf: FileDown,
    text: FileText,
};
const SIZE_UNITS = ['B', 'KB', 'MB'];
const SIZE_DIVISOR = 1024;
function formatSize(bytes) {
    let value = bytes;
    let unitIndex = 0;
    while (value >= SIZE_DIVISOR && unitIndex < SIZE_UNITS.length - 1) {
        value /= SIZE_DIVISOR;
        unitIndex++;
    }
    return `${unitIndex === 0 ? String(value) : value.toFixed(1)} ${SIZE_UNITS[unitIndex]}`;
}
function getExtension(name) {
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toUpperCase() : '';
}
function AttachmentFileChip({ attachment, onRemove, }) {
    const Icon = KIND_ICON[attachment.kind];
    const ext = getExtension(attachment.name);
    return (_jsxs("div", { className: cn('group/chip relative inline-flex items-center gap-2 rounded-lg border border-border', 'bg-bg px-2.5 py-1.5 text-[12px] text-text-secondary'), children: [_jsx("div", { className: "flex size-8 shrink-0 items-center justify-center rounded-md bg-bg-tertiary", children: _jsx(Icon, { className: "size-4 text-text-tertiary" }) }), _jsxs("div", { className: "flex flex-col gap-0 overflow-hidden", children: [_jsx("span", { className: "max-w-[180px] truncate text-[12px] font-medium leading-tight text-text-primary", children: attachment.name }), _jsxs("span", { className: "text-[10px] leading-tight text-text-tertiary", children: [ext && `${ext} \u00B7 `, formatSize(attachment.sizeBytes)] })] }), _jsx(Button, { variant: "unstyled", type: "button", onClick: onRemove, className: "ml-0.5 rounded p-0.5 text-text-muted transition-colors hover:text-text-primary", title: `Remove ${attachment.name}`, children: _jsx(X, { className: "size-3" }) })] }));
}
export function AutoTextAttachmentChips({ pendingTextAttachmentChips, attachments, onRemoveAttachment, onRemovePendingAttachment, }) {
    if (pendingTextAttachmentChips.length === 0 && attachments.length === 0)
        return null;
    const attachmentIdsWithInlineProgress = new Set();
    for (const chip of pendingTextAttachmentChips) {
        if (typeof chip.attachmentId === 'string') {
            attachmentIdsWithInlineProgress.add(chip.attachmentId);
        }
    }
    const visibleAttachments = [];
    for (const attachment of attachments) {
        if (!attachmentIdsWithInlineProgress.has(attachment.id)) {
            visibleAttachments.push(attachment);
        }
    }
    return (_jsxs("div", { className: "mb-2 flex flex-wrap gap-1.5", children: [pendingTextAttachmentChips.map((chip) => (_jsxs("span", { className: "inline-flex min-w-[210px] flex-col rounded-lg border border-border bg-bg px-2.5 py-1.5 text-[12px] text-text-secondary", children: [_jsxs("span", { className: "inline-flex items-center gap-1.5", children: [chip.status === 'ready' ? (_jsx(Check, { className: "size-3 text-accent" })) : (_jsx(Loader2, { className: "size-3 animate-spin text-text-tertiary" })), _jsx("span", { className: "max-w-[120px] truncate", children: chip.name }), _jsxs("span", { className: "text-[11px] text-text-tertiary", children: [String(chip.progressPercent), "%"] }), chip.status === 'ready' && chip.attachmentId ? (_jsx(Button, { variant: "unstyled", type: "button", onClick: () => {
                                    if (!chip.attachmentId)
                                        return;
                                    onRemovePendingAttachment(chip.operationId, chip.attachmentId);
                                }, className: "text-text-tertiary transition-colors hover:text-text-primary", title: `Remove ${chip.name}`, children: _jsx(X, { className: "size-3" }) })) : null] }), _jsx("span", { role: "progressbar", "aria-valuemin": 0, "aria-valuemax": PERCENT_BASE, "aria-valuenow": chip.progressPercent, className: "mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary", children: _jsx("span", { className: "block h-full bg-accent transition-[width] duration-100", style: { width: `${String(chip.progressPercent)}%` } }) })] }, chip.operationId))), visibleAttachments.map((attachment) => (_jsx(AttachmentFileChip, { attachment: attachment, onRemove: () => onRemoveAttachment(attachment.id) }, attachment.id)))] }));
}
