import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { X } from 'lucide-react';
import { useFeedback } from '@/features/feedback/hooks/useFeedback';
import { usePreferencesStore } from '@/features/settings/state';
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey';
import { Button } from '@/shared/ui/Button';
import { ModalDialog } from '@/shared/ui/ModalDialog';
import { useUIStore } from '@/shell/ui-store';
import { FeedbackModalBody, FeedbackModalFooter } from './FeedbackModalContent';
export function FeedbackModal() {
    const closeFeedbackModal = useUIStore((s) => s.closeFeedbackModal);
    const errorContext = useUIStore((s) => s.feedbackErrorContext);
    const lastUserMessage = null;
    const activeModel = usePreferencesStore((s) => s.settings.selectedModel);
    const activeProvider = null;
    const fb = useFeedback(errorContext, lastUserMessage, activeModel, activeProvider);
    useEscapeHotkey(closeFeedbackModal);
    const canSubmit = fb.title.trim().length > 0 && !fb.submitting && !fb.cooldownActive;
    const ghReady = fb.ghStatus?.available && fb.ghStatus.authenticated;
    return (_jsx(ModalDialog, { label: "Report issue", onClose: closeFeedbackModal, children: _jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border px-4 py-3", children: [_jsx("h2", { className: "text-sm font-semibold text-text-primary", children: "Report Issue" }), _jsx(Button, { variant: "unstyled", type: "button", onClick: closeFeedbackModal, className: "rounded p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary", title: "Close", children: _jsx(X, { className: "size-4" }) })] }), _jsx(FeedbackModalBody, { fb: fb, ghReady: ghReady, errorContext: errorContext, lastUserMessage: lastUserMessage }), _jsx(FeedbackModalFooter, { fb: fb, canSubmit: canSubmit, ghReady: ghReady, onClose: closeFeedbackModal })] }) }));
}
