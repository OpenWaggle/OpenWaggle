import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { classifyErrorMessage } from '@shared/types/errors';
import { AlertCircle, Bug, Check, ChevronDown, ChevronRight, Copy, FolderOpen, RefreshCw, Settings, X, } from 'lucide-react';
import { useState } from 'react';
import { clearLastAgentErrorInfo, getLastAgentErrorInfo, } from '@/features/chat/lib/agent-error-store';
import { api } from '@/shared/lib/ipc';
import { createRendererLogger } from '@/shared/lib/logger';
import { Button } from '@/shared/ui/Button';
import { useUIStore } from '@/shell/ui-store';
const logger = createRendererLogger('chat');
const DELAY_MS = 2000;
function formatErrorDetails(error, info) {
    const detailLines = [`Raw: ${info.message}`];
    if (info.code !== 'unknown') {
        detailLines.push(`Code: ${info.code}`);
    }
    const stackIsRendererCreatedTransportError = error.stack?.startsWith(`Error: ${info.message}`);
    if (error.stack && error.stack !== error.message && !stackIsRendererCreatedTransportError) {
        detailLines.push('', error.stack);
    }
    return detailLines.join('\n');
}
function resolveErrorInfo(error, sessionId) {
    if (sessionId) {
        const stored = getLastAgentErrorInfo(sessionId);
        if (stored)
            return stored;
    }
    return classifyErrorMessage(error.message);
}
function ChatErrorActions({ info, isAuthError, copy, retry, onOpenSettings, onDismiss, onReport, }) {
    return (_jsxs("div", { className: "flex gap-2 mt-2", children: [isAuthError && onOpenSettings && (_jsxs(Button, { variant: "accent", onClick: onOpenSettings, children: [_jsx(Settings, { className: "size-3" }), "Open Settings"] })), info.retryable && retry.lastUserMessage && retry.onRetry && (_jsxs(Button, { variant: "danger", onClick: () => {
                    retry.onDismiss();
                    retry.onRetry?.(retry.lastUserMessage ?? '');
                }, children: [_jsx(RefreshCw, { className: "size-3" }), "Retry"] })), _jsxs(Button, { variant: "subtle", onClick: copy.onCopy, children: [copy.copied ? _jsx(Check, { className: "size-3" }) : _jsx(Copy, { className: "size-3" }), copy.copied ? 'Copied' : 'Copy'] }), !isAuthError && (_jsxs(Button, { variant: "subtle", onClick: onReport, children: [_jsx(Bug, { className: "size-3" }), "Report"] })), !isAuthError && _jsx(OpenLogsButton, {}), _jsxs(Button, { variant: "subtle", onClick: onDismiss, children: [_jsx(X, { className: "size-3" }), "Dismiss"] })] }));
}
function OpenLogsButton() {
    return (_jsxs(Button, { variant: "subtle", onClick: () => {
            api.openLogsDir().catch((err) => {
                logger.warn('Failed to open logs directory', { error: String(err) });
            });
        }, children: [_jsx(FolderOpen, { className: "size-3" }), "Open Logs"] }));
}
export function ChatErrorDisplay({ error, lastUserMessage, dismissedError, sessionId, onDismiss, onOpenSettings, onRetry, }) {
    const openFeedbackModal = useUIStore((s) => s.openFeedbackModal);
    const [copied, setCopied] = useState(false);
    const [showDetails, setShowDetails] = useState(false);
    if (dismissedError === error.message)
        return null;
    const info = resolveErrorInfo(error, sessionId);
    const isAuthError = info.code === 'api-key-invalid' || info.code === 'session-expired';
    const details = formatErrorDetails(error, info);
    function handleCopy() {
        const text = `${info.userMessage}${info.suggestion ? `\n${info.suggestion}` : ''}\n\nRaw: ${info.message}`;
        api.copyToClipboard(text);
        setCopied(true);
        setTimeout(() => setCopied(false), DELAY_MS);
    }
    function handleDismiss() {
        if (sessionId)
            clearLastAgentErrorInfo(sessionId);
        onDismiss(error.message);
    }
    return (_jsx("div", { className: "my-3 rounded-xl border border-error/25 bg-error/6 px-4 py-3", children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx(AlertCircle, { className: "size-4 shrink-0 text-error mt-0.5" }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("p", { className: "text-sm text-error/90", children: info.userMessage }), info.suggestion && (_jsx("p", { className: "text-[13px] text-text-tertiary mt-1", children: info.suggestion })), details && (_jsxs("div", { className: "mt-1.5", children: [_jsxs(Button, { variant: "ghost", size: "xs", onClick: () => setShowDetails(!showDetails), children: [showDetails ? (_jsx(ChevronDown, { className: "size-3" })) : (_jsx(ChevronRight, { className: "size-3" })), "Show details"] }), showDetails && (_jsx("pre", { className: "mt-1.5 max-h-40 overflow-auto rounded-md bg-bg/50 p-2 text-[11px] text-text-tertiary font-mono whitespace-pre-wrap break-all", children: details }))] })), _jsx(ChatErrorActions, { info: info, isAuthError: isAuthError, copy: { copied, onCopy: handleCopy }, retry: { lastUserMessage, onRetry, onDismiss: handleDismiss }, onOpenSettings: onOpenSettings, onDismiss: handleDismiss, onReport: () => openFeedbackModal(info) })] })] }) }));
}
