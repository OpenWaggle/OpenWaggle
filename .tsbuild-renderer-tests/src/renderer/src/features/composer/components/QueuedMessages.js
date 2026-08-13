import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowUp, Timer, Trash2 } from 'lucide-react';
import { selectQueue, useMessageQueueStore } from '@/features/chat/state';
import { Button } from '@/shared/ui/Button';
/**
 * Queued messages panel that docks above the Composer.
 *
 * The Composer fills 100% of the parent container. The queue stays inset just
 * inside the composer's rounded shoulders so it reads like a docked tab rather
 * than a separate full-width panel.
 */
export function QueuedMessages({ sessionId, onSteer, isStreaming, isCompacting = false, }) {
    const queue = useMessageQueueStore(selectQueue(sessionId));
    const dismiss = useMessageQueueStore((s) => s.dismiss);
    if (queue.length === 0 || !sessionId)
        return null;
    return (_jsxs("div", { className: "mx-auto flex w-[calc(100%-28px)] flex-col gap-1.5 rounded-t-[var(--radius-panel)] border-x border-t border-border-light bg-bg-secondary p-[8px_10px_6px_10px] opacity-60", children: [_jsxs("div", { className: "flex items-center gap-1.5 px-1", children: [_jsx(Timer, { className: "size-3 text-text-tertiary" }), _jsx("span", { className: "text-[11px] font-semibold text-text-tertiary", children: isCompacting ? 'Queued until compaction finishes' : 'Queued' }), _jsx("span", { className: "flex size-[18px] items-center justify-center rounded-full bg-text-tertiary/12 text-[10px] font-semibold text-text-tertiary", children: queue.length })] }), _jsx("div", { className: "flex flex-col gap-1", children: queue.map((item) => (_jsxs("div", { className: "flex items-center gap-2 rounded-lg bg-bg/50 p-[8px_10px]", children: [_jsx("div", { className: "flex-1 text-[12px] leading-[1.5] text-text-muted whitespace-pre-wrap", children: item.payload.text || `${String(item.payload.attachments.length)} attachment(s)` }), _jsxs("div", { className: "flex items-center gap-1", children: [isStreaming && !isCompacting && (_jsxs(Button, { variant: "unstyled", type: "button", onClick: () => void onSteer(item.id), className: "flex items-center gap-1 rounded-[5px] bg-accent/8 px-2 py-1", children: [_jsx(ArrowUp, { className: "size-[11px] text-accent" }), _jsx("span", { className: "text-[10px] font-semibold text-accent", children: "Steer" })] })), _jsx(Button, { variant: "unstyled", type: "button", onClick: () => dismiss(sessionId, item.id), className: "rounded-[5px] p-[4px_5px]", title: "Dismiss", children: _jsx(Trash2, { className: "size-[11px] text-text-muted hover:text-text-primary" }) })] })] }, item.id))) })] }));
}
