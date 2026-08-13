import { formatTokens } from '@/shared/lib/format-tokens';
import { CONTEXT_METER } from '../constants/context-meter';
export function buildContextUsageRequestKey(sessionId, model, sessionVersion) {
    return sessionId ? `${sessionId}:${model}:${sessionVersion}` : '';
}
export function findContextWindow(providerModels, modelRef) {
    for (const group of providerModels) {
        const contextWindow = group.models.find((model) => model.id === modelRef)?.contextWindow;
        if (contextWindow)
            return contextWindow;
    }
    return null;
}
export function buildContextMeterValue({ snapshot, fallbackContextWindow, hasActiveSession, failed, }) {
    const contextWindow = snapshot?.contextWindow ?? fallbackContextWindow;
    const percent = resolveUsageValue(snapshot?.percent, fallbackContextWindow, hasActiveSession);
    const tokens = resolveUsageValue(snapshot?.tokens, fallbackContextWindow, hasActiveSession);
    const normalizedPercent = clampContextPercent(percent);
    return {
        contextWindow,
        dashOffset: CONTEXT_METER.GEOMETRY.CIRCUMFERENCE -
            (normalizedPercent / CONTEXT_METER.THRESHOLDS.PERCENT_MAX) *
                CONTEXT_METER.GEOMETRY.CIRCUMFERENCE,
        displayValue: percent === null ? '?' : String(Math.round(normalizedPercent)),
        strokeColor: getContextStrokeColor(percent, contextWindow !== null),
        title: formatUsageTitle({ tokens, contextWindow, percent, failed }),
    };
}
function resolveUsageValue(snapshotValue, fallbackContextWindow, hasActiveSession) {
    if (snapshotValue !== undefined)
        return snapshotValue;
    return hasActiveSession || !fallbackContextWindow ? null : 0;
}
function getContextStrokeColor(percent, hasContextWindow) {
    if (!hasContextWindow || percent === null)
        return 'var(--color-text-muted)';
    if (percent >= CONTEXT_METER.THRESHOLDS.ERROR_PERCENT)
        return 'var(--color-error)';
    if (percent >= CONTEXT_METER.THRESHOLDS.WARNING_PERCENT)
        return 'var(--color-warning)';
    return 'var(--color-success)';
}
function clampContextPercent(percent) {
    if (percent === null)
        return 0;
    return Math.max(0, Math.min(CONTEXT_METER.THRESHOLDS.PERCENT_MAX, percent));
}
function formatUsageTitle({ tokens, contextWindow, percent, failed }) {
    if (failed)
        return 'Context usage unavailable';
    if (!contextWindow)
        return 'Context usage';
    if (tokens === null || percent === null) {
        return `Context: ? / ${formatTokens(contextWindow)} tokens`;
    }
    return `Context: ${formatTokens(tokens)} / ${formatTokens(contextWindow)} tokens (${percent.toFixed(1)}%)`;
}
