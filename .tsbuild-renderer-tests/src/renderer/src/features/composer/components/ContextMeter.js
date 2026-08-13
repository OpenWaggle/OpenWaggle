import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useChatStore } from '@/features/chat/state';
import { useProviderStore } from '@/features/providers/state';
import { usePreferencesStore } from '@/features/settings/state';
import { formatContextWindow } from '@/shared/lib/format-tokens';
import { useContextUsageSnapshot } from '../hooks/useContextUsageSnapshot';
import { buildContextMeterValue, buildContextUsageRequestKey, findContextWindow, } from '../lib/context-meter-view';
import { ContextMeterRing } from './ContextMeterRing';
export function ContextMeter() {
    const activeSessionId = useChatStore((s) => s.activeSessionId);
    const activeSession = useChatStore((s) => s.activeSession);
    const selectedModel = usePreferencesStore((s) => s.settings.selectedModel);
    const providerModels = useProviderStore((s) => s.providerModels);
    const fallbackContextWindow = findContextWindow(providerModels, selectedModel);
    const requestKey = buildContextUsageRequestKey(activeSessionId ? String(activeSessionId) : null, selectedModel, activeSession
        ? `${String(activeSession.updatedAt)}:${String(activeSession.messages.length)}`
        : '');
    const usage = useContextUsageSnapshot({ activeSessionId, selectedModel, requestKey });
    const meter = buildContextMeterValue({
        snapshot: usage.snapshot,
        fallbackContextWindow,
        hasActiveSession: Boolean(activeSessionId),
        failed: usage.failed,
    });
    return (_jsxs("div", { className: "flex items-center gap-1.5", title: meter.title, children: [_jsx(ContextMeterRing, { displayValue: meter.displayValue, strokeColor: meter.strokeColor, dashOffset: meter.dashOffset, failed: usage.failed }), meter.contextWindow ? (_jsxs("span", { className: "hidden font-mono text-[11px] text-text-tertiary sm:inline", children: ["/ ", formatContextWindow(meter.contextWindow)] })) : null] }));
}
